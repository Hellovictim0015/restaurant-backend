import { withTransaction } from './db.js';
import { calculatePointsEarned } from './points.js';
import { incrementCouponUsage } from './coupons.js';

// Shared by /api/orders (Razorpay-unavailable dev fallback) and
// /api/payment/verify (once a real payment is confirmed). Inserts the order +
// order_items atomically, awards loyalty points to a logged-in customer when
// the order is actually paid, and returns the created order row.
export async function createRealOrder({
  customerId = null,
  orderType = 'DELIVERY',
  tableNumber = null,
  customerName,
  customerPhone,
  customerEmail,
  customerAddress,
  customerLatitude,
  customerLongitude,
  calc,
  orderNumber,
  orderStatus = 'PENDING',
  paymentStatus = 'PENDING',
  paymentMethod = 'RAZORPAY',
}) {
  // Only ever award points for a genuinely paid order tied to a logged-in
  // account — never for the Razorpay-unavailable dev fallback (paymentStatus
  // PENDING there), which has no real payment behind it. Earned on what the
  // customer actually paid (after coupon/points discounts).
  const pointsEarned =
    customerId && paymentStatus === 'PAID' ? calculatePointsEarned(calc.total) : 0;

  const couponCode = calc.couponCode || null;
  const couponDiscount = calc.couponDiscount || 0;
  const pointsRedeemed = calc.pointsRedeemed || 0;
  const pointsDiscount = calc.pointsDiscount || 0;

  return withTransaction(async (txQuery) => {
    const result = await txQuery(
      `INSERT INTO orders
        (orderNumber, orderType, tableNumber, customerId, customerName, customerPhone, customerEmail, customerAddress,
         customerLatitude, customerLongitude, distanceKm, subtotal, deliveryCharge, couponCode, couponDiscount,
         pointsRedeemed, pointsDiscount, totalAmount, orderStatus, paymentStatus, paymentMethod, pointsEarned, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orderNumber,
        orderType,
        tableNumber,
        customerId,
        customerName,
        customerPhone,
        customerEmail,
        customerAddress,
        customerLatitude,
        customerLongitude,
        calc.distanceKm,
        calc.subtotal,
        calc.deliveryCharge,
        couponCode,
        couponDiscount,
        pointsRedeemed,
        pointsDiscount,
        calc.total,
        orderStatus,
        paymentStatus,
        paymentMethod,
        pointsEarned,
        null,
      ]
    );

    const orderId = result.insertId;
    for (const item of calc.items) {
      await txQuery(
        `INSERT INTO order_items (orderId, productId, productName, variantId, variantName, price, quantity, itemTotal)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          item.productId,
          item.productName,
          item.variantId ?? null,
          item.variantName ?? null,
          item.price,
          item.quantity,
          item.itemTotal,
        ]
      );
    }

    // Redeemed points are spent as soon as the order is genuinely placed
    // (regardless of payment status) since the discount is already applied —
    // otherwise the customer would keep the points AND the discount.
    if (pointsRedeemed > 0 && customerId) {
      await txQuery('UPDATE customers SET points = points - ? WHERE id = ?', [pointsRedeemed, customerId]);
    }
    if (pointsEarned > 0) {
      await txQuery('UPDATE customers SET points = points + ? WHERE id = ?', [pointsEarned, customerId]);
    }
    if (calc.couponId) {
      await incrementCouponUsage(calc.couponId);
    }

    const [createdOrder] = await txQuery('SELECT * FROM orders WHERE id = ?', [orderId]);
    return createdOrder;
  });
}
