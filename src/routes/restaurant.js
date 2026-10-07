import { Router } from 'express';
import { query } from '../lib/db.js';
import { success, failure } from '../lib/response.js';
import { requireAdmin } from '../middleware/auth.js';
import { requireJsonBody } from '../middleware/body.js';

const router = Router();

router.get('/', async (_req, res) => {
  const [settings] = await query('SELECT * FROM restaurant_settings WHERE id = 1');
  if (!settings) return failure(res, 'Restaurant settings not configured', 404);
  return success(res, settings, 'Restaurant settings fetched successfully');
});

router.put('/', requireAdmin, requireJsonBody, async (req, res) => {
  const body = req.body;
  const [existing] = await query('SELECT * FROM restaurant_settings WHERE id = 1');
  if (!existing) return failure(res, 'Restaurant settings not configured', 404);

  const name = body.name !== undefined ? body.name.trim() : existing.name;
  if (!name) return failure(res, 'Restaurant name is required', 400);

  let latitude = existing.latitude;
  let longitude = existing.longitude;
  if (body.latitude !== undefined) {
    const lat = Number(body.latitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      return failure(res, 'Latitude must be a valid number between -90 and 90', 400);
    }
    latitude = lat;
  }
  if (body.longitude !== undefined) {
    const lng = Number(body.longitude);
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      return failure(res, 'Longitude must be a valid number between -180 and 180', 400);
    }
    longitude = lng;
  }

  const logo = body.logo !== undefined ? body.logo : existing.logo;
  const logoPublicId = body.logoPublicId !== undefined ? body.logoPublicId : existing.logoPublicId;
  const address = body.address !== undefined ? body.address : existing.address;
  const phone = body.phone !== undefined ? body.phone : existing.phone;
  const email = body.email !== undefined ? body.email : existing.email;
  const status = body.status !== undefined ? (body.status ? 1 : 0) : existing.status;
  const minOrderAmount = body.minOrderAmount !== undefined ? Number(body.minOrderAmount) : existing.minOrderAmount;

  let deliveryChargePerKm = existing.deliveryChargePerKm;
  if (body.deliveryChargePerKm !== undefined) {
    const rate = Number(body.deliveryChargePerKm);
    if (!Number.isFinite(rate) || rate <= 0) {
      return failure(res, 'Delivery charge per km must be a positive number', 400);
    }
    deliveryChargePerKm = rate;
  }

  let freeDeliveryKm = existing.freeDeliveryKm;
  if (body.freeDeliveryKm !== undefined) {
    const free = Number(body.freeDeliveryKm);
    if (!Number.isFinite(free) || free < 0) {
      return failure(res, 'Free delivery KM must be zero or a positive number', 400);
    }
    freeDeliveryKm = free;
  }

  let maxDeliveryKm = existing.maxDeliveryKm;
  if (body.maxDeliveryKm !== undefined) {
    if (body.maxDeliveryKm === null || body.maxDeliveryKm === '') {
      maxDeliveryKm = null; // no limit
    } else {
      const max = Number(body.maxDeliveryKm);
      if (!Number.isFinite(max) || max <= 0) {
        return failure(res, 'Maximum delivery distance must be a positive number', 400);
      }
      maxDeliveryKm = max;
    }
  }

  await query(
    `UPDATE restaurant_settings
     SET name = ?, logo = ?, logoPublicId = ?, address = ?, phone = ?, email = ?, latitude = ?, longitude = ?, status = ?, minOrderAmount = ?, deliveryChargePerKm = ?, freeDeliveryKm = ?, maxDeliveryKm = ?
     WHERE id = 1`,
    [name, logo, logoPublicId, address, phone, email, latitude, longitude, status, minOrderAmount, deliveryChargePerKm, freeDeliveryKm, maxDeliveryKm]
  );

  const [updated] = await query('SELECT * FROM restaurant_settings WHERE id = 1');
  return success(res, updated, 'Restaurant settings updated successfully');
});

export default router;
