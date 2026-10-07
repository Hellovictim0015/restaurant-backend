import { Router } from 'express';
import { query } from '../lib/db.js';
import { success, failure } from '../lib/response.js';
import { calculateDistanceKm, calculateDeliveryCharge } from '../lib/distance.js';
import { requireJsonBody } from '../middleware/body.js';

const router = Router();

// Standalone distance check — no cart/items needed. Takes the customer's
// lat/lng, compares it against the restaurant's configured coordinates
// (Admin → Settings), and returns the distance + what delivery charge that
// would produce. Mainly a debugging/verification tool — the real order flow
// computes this itself inside /api/orders/calculate and /api/orders.
router.post('/', requireJsonBody, async (req, res) => {
  const lat = Number(req.body.latitude);
  const lng = Number(req.body.longitude);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return failure(res, 'A valid latitude is required', 400);
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    return failure(res, 'A valid longitude is required', 400);
  }

  const [restaurant] = await query('SELECT * FROM restaurant_settings WHERE id = 1');
  if (!restaurant) return failure(res, 'Restaurant is not configured yet', 500);
  if (restaurant.latitude === null || restaurant.longitude === null) {
    return failure(res, 'Restaurant location is not configured yet in Admin → Settings', 500);
  }

  const distanceKm = Math.round(
    calculateDistanceKm(Number(restaurant.latitude), Number(restaurant.longitude), lat, lng) * 100
  ) / 100;
  const deliveryCharge = calculateDeliveryCharge(distanceKm, restaurant.deliveryChargePerKm, restaurant.freeDeliveryKm);

  return success(
    res,
    {
      distanceKm,
      deliveryCharge,
      restaurant: {
        name: restaurant.name,
        latitude: Number(restaurant.latitude),
        longitude: Number(restaurant.longitude),
      },
      customer: {
        latitude: lat,
        longitude: lng,
      },
    },
    'Distance calculated successfully'
  );
});

export default router;
