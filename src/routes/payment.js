import { Router } from 'express';
import { query } from '../lib/db.js';
import { success, failure } from '../lib/response.js';
import { getRazorpay, verifyPaymentSignature } from '../lib/razorpay.js';
import { createRealOrder } from '../lib/orderCreate.js';
import { generateOrderNumber } from '../lib/orderNumber.js';
import { requireJsonBody } from '../middleware/body.js';

const router = Router();

function parseItems(itemsJson) {
  return typeof itemsJson === 'string' ? JSON.parse(itemsJson) : itemsJson;
}

// Re-opens a fresh Razorpay order for an existing checkout draft — used when
// the previous Razorpay order expired or the app lost it (e.g. was killed)
// before the customer completed payment. No real `orders` row exists yet.
router.post('/create-order', requireJsonBody, async (req, res) => {
  const { pendingOrderId } = req.body;
  if (!pendingOrderId) return failure(res, 'pendingOrderId is required', 400);

  const [pendingOrder] = await query('SELECT * FROM pending_orders WHERE id = ?', [pendingOrderId]);
  if (!pendingOrder) {
    return failure(res, 'This checkout has expired. Please go back to your cart and try again.', 404);
  }

  try {
    const razorpay = getRazorpay();
    const razorpayOrder = await razorpay.orders.create({
      amount: Math.round(pendingOrder.totalAmount * 100),
      currency: 'INR',
      receipt: `PENDING-${pendingOrder.id}-${Date.now()}`,
    });

    await query('UPDATE pending_orders SET razorpayOrderId = ? WHERE id = ?', [razorpayOrder.id, pendingOrder.id]);

    return success(
      res,
      {
        orderId: razorpayOrder.id,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        keyId: process.env.RAZORPAY_KEY_ID,
      },
      'Razorpay order created successfully'
    );
  } catch (error) {
    console.error('Razorpay order creation failed:', error);
    return failure(res, 'Unable to initiate payment. Please try again.', 502);
  }
});

// The order is only ever written to `orders` here, once payment is verified —
// see POST /api/orders for why the checkout draft lives in `pending_orders`
// until now.
router.post('/verify', requireJsonBody, async (req, res) => {
  try {
    return await handleVerify(req.body, res);
  } catch (error) {
    console.error('Payment verification failed unexpectedly:', error);
    return failure(res, 'Unable to verify your payment right now. Please contact the restaurant.', 500);
  }
});

async function handleVerify(body, res) {
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = body;
  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    return failure(res, 'Missing payment verification fields', 400);
  }

  const [pendingOrder] = await query('SELECT * FROM pending_orders WHERE razorpayOrderId = ?', [razorpayOrderId]);
  if (!pendingOrder) {
    return failure(res, 'This checkout has expired or was already processed. Please try again.', 404);
  }

  const isValid = verifyPaymentSignature({
    orderId: razorpayOrderId,
    paymentId: razorpayPaymentId,
    signature: razorpaySignature,
  });

  if (!isValid) {
    return failure(res, 'Payment verification failed', 400);
  }

  // pending_orders only stores the coupon's code (not its id) — look it up
  // again so usage can be incremented the same way as the other order-
  // creation paths in lib/orderCreate.js.
  let couponId = null;
  if (pendingOrder.couponCode) {
    const [coupon] = await query('SELECT id FROM coupons WHERE code = ?', [pendingOrder.couponCode]);
    couponId = coupon ? coupon.id : null;
  }

  const order = await createRealOrder({
    customerId: pendingOrder.customerId,
    orderType: pendingOrder.orderType,
    tableNumber: pendingOrder.tableNumber,
    customerName: pendingOrder.customerName,
    customerPhone: pendingOrder.customerPhone,
    customerEmail: pendingOrder.customerEmail,
    customerAddress: pendingOrder.customerAddress,
    customerLatitude: pendingOrder.customerLatitude,
    customerLongitude: pendingOrder.customerLongitude,
    calc: {
      items: parseItems(pendingOrder.itemsJson),
      distanceKm: pendingOrder.distanceKm,
      subtotal: pendingOrder.subtotal,
      deliveryCharge: pendingOrder.deliveryCharge,
      couponCode: pendingOrder.couponCode,
      couponId,
      couponDiscount: pendingOrder.couponDiscount,
      pointsRedeemed: pendingOrder.pointsRedeemed,
      pointsDiscount: pendingOrder.pointsDiscount,
      total: pendingOrder.totalAmount,
    },
    orderNumber: generateOrderNumber(),
    orderStatus: 'CONFIRMED',
    paymentStatus: 'PAID',
  });

  await query(
    `INSERT INTO payments (orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature, amount, currency, status)
     VALUES (?, ?, ?, ?, ?, 'INR', 'PAID')`,
    [order.id, razorpayOrderId, razorpayPaymentId, razorpaySignature, pendingOrder.totalAmount]
  );

  await query('DELETE FROM pending_orders WHERE id = ?', [pendingOrder.id]);

  return success(res, order, 'Payment verified — order placed successfully');
}

export default router;
