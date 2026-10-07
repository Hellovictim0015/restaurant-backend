// Loyalty points: 20 points for every full ₹100 spent, only on orders of
// ₹100 or more. E.g. ₹100 -> 20, ₹150 -> 20, ₹200 -> 40.
const POINTS_PER_SLAB = 20;
const SLAB_AMOUNT = 100;

// Redemption: 1 point = ₹0.50, only once the customer holds at least 100
// points (₹50 worth) — they don't have to redeem all of them at once, but
// can't start redeeming below that balance.
export const POINT_VALUE_RUPEES = 0.5;
export const MIN_POINTS_TO_REDEEM = 100;

export function calculatePointsEarned(orderAmount) {
  const amount = Number(orderAmount) || 0;
  if (amount < SLAB_AMOUNT) return 0;
  return Math.floor(amount / SLAB_AMOUNT) * POINTS_PER_SLAB;
}

export function calculatePointsDiscount(points) {
  const n = Number(points) || 0;
  if (n <= 0) return 0;
  return Math.round(n * POINT_VALUE_RUPEES * 100) / 100;
}

// Redemption is all-or-nothing: once a customer's balance reaches the
// threshold, choosing to redeem cashes in their *entire* current balance as
// a discount — no partial-amount picker to keep the checkout UI simple.
// Throws a plain Error with a user-facing message if they don't qualify yet.
export function resolvePointsRedemption(wantsToRedeem, customerPointsBalance) {
  if (!wantsToRedeem) return 0;
  const balance = Number(customerPointsBalance) || 0;
  if (balance < MIN_POINTS_TO_REDEEM) {
    throw new Error(`You need at least ${MIN_POINTS_TO_REDEEM} points to redeem — you currently have ${balance}.`);
  }
  return balance;
}
