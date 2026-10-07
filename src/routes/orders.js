import { Router } from 'express';
import { query } from '../lib/db.js';
import { success, failure } from '../lib/response.js';
import { calculateOrder, OrderValidationError } from '../lib/orderCalc.js';
import { getRazorpay } from '../lib/razorpay.js';
import { getCurrentAdmin } from '../lib/auth.js';
import { generateOrderNumber } from '../lib/orderNumber.js';
import { createRealOrder } from '../lib/orderCreate.js';
import { getCustomerFromRequest } from '../lib/customerAuth.js';
import { requireAdmin } from '../middleware/auth.js';
import { requireJsonBody } from '../middleware/body.js';

const router = Router();

const PENDING_ORDER_TTL_HOURS = 24;
const ORDER_TYPES = ['DELIVERY', 'DINE_IN'];
const ORDER_STATUSES = ['PENDING', 'CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'];
const PAYMENT_STATUSES = ['PENDING', 'PAID', 'FAILED', 'REFUNDED'];

// The JWT's id is never trusted blindly — a token issued by a different
// backend/database can claim an id that doesn't exist here, which would
// otherwise crash the order insert with a foreign-key error. Confirm the row
// is real first; treat it as a guest checkout if not.
async function resolveCustomerId(req) {
  const authCustomer = await getCustomerFromRequest(req);
  if (!authCustomer?.id) return null;
  const [existingCustomer] = await query('SELECT id FROM customers WHERE id = ?', [authCustomer.id]);
  return existingCustomer ? existingCustomer.id : null;
}

// Best-effort cleanup of abandoned checkouts (cart calculated, Razorpay order
// opened, payment never completed). Runs inline on each new checkout instead
// of a separate cron job — cheap enough at this scale.
async function cleanupStalePendingOrders() {
  await query(
    `DELETE FROM pending_orders WHERE createdAt < DATE_SUB(NOW(), INTERVAL ? HOUR)`,
    [PENDING_ORDER_TTL_HOURS]
  );
}

// Public callers may only ever see their own phone number's orders; the admin
// dashboard can list everything with any filter.
router.get('/', async (req, res) => {
  const { phone, status, paymentStatus, orderType } = req.query;
  const admin = await getCurrentAdmin(req);

  if (!phone && !admin) {
    return failure(res, 'Not authenticated', 401);
  }

  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const where = [];
  const params = [];
  if (phone) {
    where.push('customerPhone = ?');
    params.push(phone);
  }
  if (status) {
    where.push('orderStatus = ?');
    params.push(status);
  }
  if (paymentStatus) {
    where.push('paymentStatus = ?');
    params.push(paymentStatus);
  }
  if (orderType) {
    where.push('orderType = ?');
    params.push(orderType);
  }

  const sql = `
    SELECT * FROM orders
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY createdAt DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  const orders = await query(sql, params);
  return success(res, orders, 'Orders fetched successfully');
});

// Preview subtotal/distance/delivery charge/total without creating an order.
router.post('/calculate', requireJsonBody, async (req, res) => {
  const body = req.body;
  try {
    const customerId = await resolveCustomerId(req);
    const result = await calculateOrder({
      items: body.items,
      customerLatitude: body.latitude,
      customerLongitude: body.longitude,
      orderType: body.orderType,
      tableNumber: body.tableNumber,
      couponCode: body.couponCode,
      redeemPoints: body.redeemPoints,
      customerId,
    });

    return success(
      res,
      {
        items: result.items,
        subtotal: result.subtotal,
        distanceKm: result.distanceKm,
        deliveryCharge: result.deliveryCharge,
        couponCode: result.couponCode,
        couponDiscount: result.couponDiscount,
        pointsRedeemed: result.pointsRedeemed,
        pointsDiscount: result.pointsDiscount,
        total: result.total,
        orderType: result.orderType,
      },
      'Order total calculated successfully'
    );
  } catch (error) {
    if (error instanceof OrderValidationError) {
      return failure(res, error.message, error.status);
    }
    console.error('Order calculation failed:', error);
    return failure(res, 'Unable to calculate order total', 500);
  }
});

// Creates a checkout draft (`pending_orders`) and a matching Razorpay order.
// The real `orders` row is only written once /api/payment/verify confirms
// payment. If Razorpay isn't configured (dev environment), falls back to
// creating the order immediately with paymentStatus PENDING so the rest of
// the app keeps working without real payment credentials.
//
// `orderType`: 'DELIVERY' (default, requires customerAddress + lat/lng) or
// 'DINE_IN' (customer is at the restaurant already — requires `tableNumber`
// instead, no delivery address/location/charge).
router.post('/', requireJsonBody, async (req, res) => {
  try {
    return await handleCreateOrder(req, res);
  } catch (error) {
    // Catch-all so a schema mismatch or any other unexpected server error
    // always comes back as a clean JSON error the app can parse.
    console.error('Order creation failed unexpectedly:', error);
    return failure(res, 'Unable to place your order right now. Please try again.', 500);
  }
});

async function handleCreateOrder(req, res) {
  const body = req.body;
  const {
    customerName,
    customerPhone,
    customerEmail,
    customerAddress,
    items,
    latitude,
    longitude,
    notes,
    tableNumber,
  } = body;
  const orderType = ORDER_TYPES.includes(body.orderType) ? body.orderType : 'DELIVERY';

  if (!customerName || !customerName.trim()) return failure(res, 'Customer name is required', 400);
  if (!customerPhone || !/^\+?[0-9]{7,15}$/.test(customerPhone.trim())) {
    return failure(res, 'A valid customer phone number is required', 400);
  }
  if (orderType === 'DELIVERY' && (!customerAddress || !customerAddress.trim())) {
    return failure(res, 'Delivery address is required', 400);
  }
  if (orderType === 'DINE_IN' && (!tableNumber || !String(tableNumber).trim())) {
    return failure(res, 'Table number is required for a dine-in order', 400);
  }

  // Optional — a logged-in customer (Authorization: Bearer <token>) gets the
  // order linked to their account, earns loyalty points, and may redeem
  // points or a coupon; guest checkout (no token) still works.
  const customerId = await resolveCustomerId(req);

  let calc;
  try {
    calc = await calculateOrder({
      items,
      customerLatitude: latitude,
      customerLongitude: longitude,
      orderType,
      tableNumber,
      couponCode: body.couponCode,
      redeemPoints: body.redeemPoints,
      customerId,
    });
  } catch (error) {
    if (error instanceof OrderValidationError) return failure(res, error.message, error.status);
    console.error('Order calculation failed:', error);
    return failure(res, 'Unable to calculate order total', 500);
  }

  await cleanupStalePendingOrders();

  const customer = {
    customerId,
    orderType,
    tableNumber: calc.tableNumber,
    customerName: customerName.trim(),
    customerPhone: customerPhone.trim(),
    customerEmail: customerEmail || null,
    // Dine-in has no delivery address/location — record the table and use
    // the restaurant's own coordinates (the customer is physically there).
    customerAddress:
      orderType === 'DINE_IN' ? `Dine-in — Table ${calc.tableNumber}` : customerAddress.trim(),
    customerLatitude: orderType === 'DINE_IN' ? Number(calc.restaurant.latitude) || 0 : Number(latitude),
    customerLongitude: orderType === 'DINE_IN' ? Number(calc.restaurant.longitude) || 0 : Number(longitude),
    notes: notes || null,
  };

  // Dine-in customers can choose to pay at the restaurant instead of online —
  // skip Razorpay entirely and place the order right away, already CONFIRMED.
  const wantsCashPayment = orderType === 'DINE_IN' && body.paymentMethod === 'CASH';
  if (wantsCashPayment) {
    const order = await createRealOrder({
      ...customer,
      calc,
      orderNumber: generateOrderNumber(),
      paymentMethod: 'CASH',
      orderStatus: 'CONFIRMED',
    });
    const orderItems = await query('SELECT * FROM order_items WHERE orderId = ?', [order.id]);
    return success(
      res,
      { pending: false, order, items: orderItems, razorpay: null },
      'Order placed — pay at the restaurant',
      201
    );
  }

  let razorpayOrder = null;
  try {
    const razorpay = getRazorpay();
    razorpayOrder = await razorpay.orders.create({
      amount: Math.round(calc.total * 100), // paise
      currency: 'INR',
      receipt: `PENDING-${Date.now()}`,
    });
  } catch (error) {
    console.error('Razorpay order creation failed (falling back to direct order creation):', error);
  }

  // Razorpay unavailable — create the real order right away (dev/demo fallback).
  if (!razorpayOrder) {
    const order = await createRealOrder({ ...customer, calc, orderNumber: generateOrderNumber() });
    const orderItems = await query('SELECT * FROM order_items WHERE orderId = ?', [order.id]);
    return success(res, { pending: false, order, items: orderItems, razorpay: null }, 'Order created successfully', 201);
  }

  const result = await query(
    `INSERT INTO pending_orders
      (razorpayOrderId, orderType, tableNumber, customerId, customerName, customerPhone, customerEmail, customerAddress,
       customerLatitude, customerLongitude, distanceKm, subtotal, deliveryCharge, couponCode, couponDiscount,
       pointsRedeemed, pointsDiscount, totalAmount, itemsJson, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      razorpayOrder.id,
      customer.orderType,
      customer.tableNumber,
      customer.customerId,
      customer.customerName,
      customer.customerPhone,
      customer.customerEmail,
      customer.customerAddress,
      customer.customerLatitude,
      customer.customerLongitude,
      calc.distanceKm,
      calc.subtotal,
      calc.deliveryCharge,
      calc.couponCode,
      calc.couponDiscount,
      calc.pointsRedeemed,
      calc.pointsDiscount,
      calc.total,
      JSON.stringify(calc.items),
      customer.notes,
    ]
  );

  return success(
    res,
    {
      pending: true,
      pendingOrderId: result.insertId,
      preview: {
        items: calc.items,
        subtotal: calc.subtotal,
        distanceKm: calc.distanceKm,
        deliveryCharge: calc.deliveryCharge,
        couponCode: calc.couponCode,
        couponDiscount: calc.couponDiscount,
        pointsRedeemed: calc.pointsRedeemed,
        pointsDiscount: calc.pointsDiscount,
        total: calc.total,
      },
      razorpay: {
        orderId: razorpayOrder.id,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        keyId: process.env.RAZORPAY_KEY_ID,
      },
    },
    'Checkout created — complete payment to place the order',
    201
  );
}

// Public — order lookup by numeric id or orderNumber, for customer tracking.
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const isNumeric = /^\d+$/.test(id);
  const [order] = await query(
    isNumeric ? 'SELECT * FROM orders WHERE id = ?' : 'SELECT * FROM orders WHERE orderNumber = ?',
    [id]
  );
  if (!order) return failure(res, 'Order not found', 404);

  const items = await query('SELECT * FROM order_items WHERE orderId = ?', [order.id]);
  const [payment] = await query('SELECT * FROM payments WHERE orderId = ? ORDER BY id DESC LIMIT 1', [order.id]);

  return success(res, { ...order, items, payment: payment || null }, 'Order fetched successfully');
});

router.put('/:id/status', requireAdmin, requireJsonBody, async (req, res) => {
  const { id } = req.params;
  const [order] = await query('SELECT * FROM orders WHERE id = ?', [id]);
  if (!order) return failure(res, 'Order not found', 404);

  const { orderStatus, paymentStatus } = req.body;
  if (orderStatus === undefined && paymentStatus === undefined) {
    return failure(res, 'Provide orderStatus and/or paymentStatus to update', 400);
  }
  if (orderStatus !== undefined && !ORDER_STATUSES.includes(orderStatus)) {
    return failure(res, `orderStatus must be one of: ${ORDER_STATUSES.join(', ')}`, 400);
  }
  if (paymentStatus !== undefined && !PAYMENT_STATUSES.includes(paymentStatus)) {
    return failure(res, `paymentStatus must be one of: ${PAYMENT_STATUSES.join(', ')}`, 400);
  }

  await query(
    `UPDATE orders SET orderStatus = ?, paymentStatus = ? WHERE id = ?`,
    [orderStatus ?? order.orderStatus, paymentStatus ?? order.paymentStatus, id]
  );

  const [updated] = await query('SELECT * FROM orders WHERE id = ?', [id]);
  return success(res, updated, 'Order status updated successfully');
});

export default router;
