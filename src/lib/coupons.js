import { query } from './db.js';

export class CouponError extends Error {}

// Validates a coupon against the current cart subtotal and returns the
// discount amount (never more than the subtotal itself). Throws a plain
// CouponError with a user-facing message on any failure.
export async function validateCoupon(code, subtotal) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!normalized) throw new CouponError('Enter a coupon code');

  const [coupon] = await query('SELECT * FROM coupons WHERE code = ?', [normalized]);
  if (!coupon) throw new CouponError('This coupon code doesn’t exist');
  if (!coupon.status) throw new CouponError('This coupon is no longer active');
  if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) {
    throw new CouponError('This coupon has expired');
  }
  if (Number(coupon.minOrderAmount) > 0 && subtotal < Number(coupon.minOrderAmount)) {
    throw new CouponError(`This coupon needs a minimum order of ₹${coupon.minOrderAmount}`);
  }

  let discount;
  if (coupon.discountType === 'PERCENTAGE') {
    discount = (subtotal * Number(coupon.discountValue)) / 100;
    if (coupon.maxDiscount !== null && discount > Number(coupon.maxDiscount)) {
      discount = Number(coupon.maxDiscount);
    }
  } else {
    discount = Number(coupon.discountValue);
  }
  discount = Math.min(Math.round(discount * 100) / 100, subtotal);

  return { coupon, discount };
}

export async function incrementCouponUsage(couponId) {
  await query('UPDATE coupons SET timesUsed = timesUsed + 1 WHERE id = ?', [couponId]);
}
