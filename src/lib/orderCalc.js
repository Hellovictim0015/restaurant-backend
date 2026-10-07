import { query } from './db.js';
import { calculateDistanceKm, calculateDeliveryCharge, calculateTieredDeliveryCharge } from './distance.js';
import { validateCoupon, CouponError } from './coupons.js';
import { calculatePointsDiscount, resolvePointsRedemption } from './points.js';

export class OrderValidationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const ORDER_TYPES = ['DELIVERY', 'DINE_IN'];

// Single source of truth for pricing. Never trust price/subtotal/delivery/total
// values sent by a client — always recompute from the database here.
//
// `orderType` DELIVERY (default): requires customer lat/lng, computes distance
// and delivery charge from the restaurant's configured coordinates.
// `orderType` DINE_IN: customer is physically at the restaurant — no location
// needed, no delivery charge, `tableNumber` identifies where to serve it.
export async function calculateOrder({
  items,
  customerLatitude,
  customerLongitude,
  orderType = 'DELIVERY',
  tableNumber,
  couponCode,
  redeemPoints,
  customerId = null,
}) {
  if (!ORDER_TYPES.includes(orderType)) {
    throw new OrderValidationError('orderType must be DELIVERY or DINE_IN');
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new OrderValidationError('Cart is empty');
  }

  let lat = null;
  let lng = null;
  if (orderType === 'DELIVERY') {
    lat = Number(customerLatitude);
    lng = Number(customerLongitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      throw new OrderValidationError('A valid customer latitude is required');
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      throw new OrderValidationError('A valid customer longitude is required');
    }
  } else if (!tableNumber || !String(tableNumber).trim()) {
    throw new OrderValidationError('Table number is required for a dine-in order');
  }

  const [restaurant] = await query('SELECT * FROM restaurant_settings WHERE id = 1');
  if (!restaurant) throw new OrderValidationError('Restaurant is not configured yet', 500);
  if (!restaurant.status) throw new OrderValidationError('Restaurant is currently closed', 503);
  if (orderType === 'DELIVERY' && (restaurant.latitude === null || restaurant.longitude === null)) {
    throw new OrderValidationError('Restaurant location is not configured yet', 500);
  }

  const productIds = [...new Set(items.map((item) => Number(item.productId)))];
  if (productIds.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new OrderValidationError('Invalid product in cart');
  }

  const placeholders = productIds.map(() => '?').join(',');
  const products = await query(
    `SELECT * FROM products WHERE id IN (${placeholders})`,
    productIds
  );
  const productMap = new Map(products.map((p) => [p.id, p]));

  const variants = await query(
    `SELECT * FROM product_variants WHERE productId IN (${placeholders})`,
    productIds
  );
  const variantMap = new Map(variants.map((v) => [v.id, v]));

  const orderItems = [];
  let subtotal = 0;

  for (const item of items) {
    const productId = Number(item.productId);
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new OrderValidationError('Item quantity must be a positive whole number');
    }

    const product = productMap.get(productId);
    if (!product) {
      throw new OrderValidationError(`Product #${productId} no longer exists`);
    }
    if (!product.status) {
      throw new OrderValidationError(`"${product.name}" is no longer available`);
    }
    if (!product.isAvailable) {
      throw new OrderValidationError(`"${product.name}" is currently out of stock`);
    }

    let price;
    let variantId = null;
    let variantName = null;

    if (item.variantId !== undefined && item.variantId !== null) {
      const variant = variantMap.get(Number(item.variantId));
      if (!variant || variant.productId !== product.id) {
        throw new OrderValidationError(`Selected option for "${product.name}" no longer exists`);
      }
      if (!variant.status) {
        throw new OrderValidationError(`"${product.name} — ${variant.name}" is no longer available`);
      }
      price = Number(variant.price);
      variantId = variant.id;
      variantName = variant.name;
    } else {
      if (product.price === null) {
        throw new OrderValidationError(`Please select an option for "${product.name}"`);
      }
      price = Number(product.price);
    }

    const itemTotal = Math.round(price * quantity * 100) / 100;
    subtotal += itemTotal;

    orderItems.push({
      productId: product.id,
      productName: product.name,
      variantId,
      variantName,
      price,
      quantity,
      itemTotal,
    });
  }

  subtotal = Math.round(subtotal * 100) / 100;

  let distanceKm = 0;
  let deliveryCharge = 0;
  if (orderType === 'DELIVERY') {
    distanceKm = Math.round(
      calculateDistanceKm(Number(restaurant.latitude), Number(restaurant.longitude), lat, lng) * 100
    ) / 100;

    const tiers = await query('SELECT * FROM delivery_charge_tiers ORDER BY upToKm ASC');
    deliveryCharge =
      tiers.length > 0
        ? calculateTieredDeliveryCharge(distanceKm, tiers)
        : calculateDeliveryCharge(distanceKm, restaurant.deliveryChargePerKm, restaurant.freeDeliveryKm);
  }

  // Coupon discount is computed against the item subtotal only (never the
  // delivery charge), and never exceeds it — see validateCoupon.
  let appliedCoupon = null;
  let couponDiscount = 0;
  if (couponCode) {
    try {
      const result = await validateCoupon(couponCode, subtotal);
      appliedCoupon = result.coupon;
      couponDiscount = result.discount;
    } catch (error) {
      if (error instanceof CouponError) throw new OrderValidationError(error.message, 400);
      throw error;
    }
  }

  // Points redemption is all-or-nothing (see lib/points.js) and requires a
  // logged-in customer whose balance has already reached the threshold.
  let pointsRedeemed = 0;
  let pointsDiscount = 0;
  if (redeemPoints) {
    if (!customerId) {
      throw new OrderValidationError('Please log in to redeem points', 401);
    }
    const [customerRow] = await query('SELECT points FROM customers WHERE id = ?', [customerId]);
    try {
      pointsRedeemed = resolvePointsRedemption(true, customerRow ? customerRow.points : 0);
    } catch (error) {
      throw new OrderValidationError(error.message, 400);
    }
    pointsDiscount = calculatePointsDiscount(pointsRedeemed);
  }

  const total = Math.max(
    Math.round((subtotal + deliveryCharge - couponDiscount - pointsDiscount) * 100) / 100,
    0
  );

  return {
    items: orderItems,
    subtotal,
    distanceKm,
    deliveryCharge,
    couponCode: appliedCoupon ? appliedCoupon.code : null,
    couponId: appliedCoupon ? appliedCoupon.id : null,
    couponDiscount,
    pointsRedeemed,
    pointsDiscount,
    total,
    restaurant,
    orderType,
    tableNumber: orderType === 'DINE_IN' ? String(tableNumber).trim() : null,
  };
}
