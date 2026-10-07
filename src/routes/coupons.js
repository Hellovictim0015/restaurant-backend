import { Router } from 'express';
import { query } from '../lib/db.js';
import { success, failure } from '../lib/response.js';
import { requireAdmin } from '../middleware/auth.js';
import { requireJsonBody } from '../middleware/body.js';

const router = Router();

const DISCOUNT_TYPES = ['FLAT', 'PERCENTAGE'];

// GET is public so the Flutter app can show active coupons without an admin
// session — pass ?status=active for that view. The admin panel calls it with
// no filter to manage everything. Create/update/delete are admin-only.
router.get('/', async (req, res) => {
  const { status } = req.query; // 'active' | 'inactive'

  const where = [];
  if (status === 'active') {
    where.push('status = 1 AND (expiresAt IS NULL OR expiresAt > NOW())');
  } else if (status === 'inactive') {
    where.push('status = 0');
  }

  const sql = `SELECT * FROM coupons ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY createdAt DESC`;
  const coupons = await query(sql);
  return success(res, coupons, 'Coupons fetched successfully');
});

router.post('/', requireAdmin, requireJsonBody, async (req, res) => {
  const body = req.body;
  const code = String(body.code || '').trim().toUpperCase();
  const discountType = DISCOUNT_TYPES.includes(body.discountType) ? body.discountType : 'FLAT';
  const discountValue = Number(body.discountValue);
  const maxDiscount = body.maxDiscount === undefined || body.maxDiscount === null || body.maxDiscount === ''
    ? null
    : Number(body.maxDiscount);
  const minOrderAmount = Number(body.minOrderAmount) || 0;
  const status = body.status === undefined ? 1 : body.status ? 1 : 0;
  const expiresAt = body.expiresAt || null;

  if (!code) return failure(res, 'Coupon code is required', 400);
  if (!/^[A-Z0-9_-]{3,50}$/.test(code)) {
    return failure(res, 'Coupon code may only contain letters, numbers, - and _', 400);
  }
  if (!Number.isFinite(discountValue) || discountValue <= 0) {
    return failure(res, 'Enter a valid discount value', 400);
  }
  if (discountType === 'PERCENTAGE' && discountValue > 100) {
    return failure(res, 'A percentage discount cannot exceed 100', 400);
  }
  if (maxDiscount !== null && (!Number.isFinite(maxDiscount) || maxDiscount <= 0)) {
    return failure(res, 'Enter a valid maximum discount amount', 400);
  }

  const [existing] = await query('SELECT id FROM coupons WHERE code = ?', [code]);
  if (existing) return failure(res, 'A coupon with this code already exists', 409);

  const result = await query(
    `INSERT INTO coupons (code, description, discountType, discountValue, maxDiscount, minOrderAmount, status, expiresAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [code, body.description || null, discountType, discountValue, maxDiscount, minOrderAmount, status, expiresAt]
  );

  const [created] = await query('SELECT * FROM coupons WHERE id = ?', [result.insertId]);
  return success(res, created, 'Coupon created successfully', 201);
});

router.put('/:id', requireAdmin, requireJsonBody, async (req, res) => {
  const { id } = req.params;
  const body = req.body;
  const [existing] = await query('SELECT * FROM coupons WHERE id = ?', [id]);
  if (!existing) return failure(res, 'Coupon not found', 404);

  const code = body.code !== undefined ? String(body.code).trim().toUpperCase() : existing.code;
  if (!code) return failure(res, 'Coupon code is required', 400);
  if (!/^[A-Z0-9_-]{3,50}$/.test(code)) {
    return failure(res, 'Coupon code may only contain letters, numbers, - and _', 400);
  }

  const discountType = body.discountType !== undefined
    ? (DISCOUNT_TYPES.includes(body.discountType) ? body.discountType : existing.discountType)
    : existing.discountType;
  const discountValue = body.discountValue !== undefined ? Number(body.discountValue) : Number(existing.discountValue);
  if (!Number.isFinite(discountValue) || discountValue <= 0) {
    return failure(res, 'Enter a valid discount value', 400);
  }
  if (discountType === 'PERCENTAGE' && discountValue > 100) {
    return failure(res, 'A percentage discount cannot exceed 100', 400);
  }

  const maxDiscount = body.maxDiscount !== undefined
    ? (body.maxDiscount === null || body.maxDiscount === '' ? null : Number(body.maxDiscount))
    : existing.maxDiscount;
  if (maxDiscount !== null && (!Number.isFinite(maxDiscount) || maxDiscount <= 0)) {
    return failure(res, 'Enter a valid maximum discount amount', 400);
  }

  const minOrderAmount = body.minOrderAmount !== undefined ? Number(body.minOrderAmount) || 0 : existing.minOrderAmount;
  const status = body.status !== undefined ? (body.status ? 1 : 0) : existing.status;
  const expiresAt = body.expiresAt !== undefined ? (body.expiresAt || null) : existing.expiresAt;
  const description = body.description !== undefined ? body.description : existing.description;

  if (code !== existing.code) {
    const [duplicate] = await query('SELECT id FROM coupons WHERE code = ? AND id != ?', [code, id]);
    if (duplicate) return failure(res, 'A coupon with this code already exists', 409);
  }

  await query(
    `UPDATE coupons SET code = ?, description = ?, discountType = ?, discountValue = ?, maxDiscount = ?,
       minOrderAmount = ?, status = ?, expiresAt = ? WHERE id = ?`,
    [code, description, discountType, discountValue, maxDiscount, minOrderAmount, status, expiresAt, id]
  );

  const [updated] = await query('SELECT * FROM coupons WHERE id = ?', [id]);
  return success(res, updated, 'Coupon updated successfully');
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const [existing] = await query('SELECT * FROM coupons WHERE id = ?', [id]);
  if (!existing) return failure(res, 'Coupon not found', 404);

  await query('DELETE FROM coupons WHERE id = ?', [id]);
  return success(res, null, 'Coupon deleted successfully');
});

export default router;
