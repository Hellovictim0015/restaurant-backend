import { Router } from 'express';
import { query } from '../lib/db.js';
import { success, failure } from '../lib/response.js';
import { parsePagination } from '../lib/pagination.js';
import { deleteImage } from '../lib/cloudinary.js';
import { requireAdmin } from '../middleware/auth.js';
import { requireJsonBody } from '../middleware/body.js';

const router = Router();

// Public — the Flutter app and landing page read the menu without a session.
router.get('/', async (req, res) => {
  const { status, search } = req.query; // status: 'active' | 'inactive'

  const where = [];
  const params = [];
  if (status === 'active') {
    where.push('status = 1');
  } else if (status === 'inactive') {
    where.push('status = 0');
  }
  if (search) {
    where.push('name LIKE ?');
    params.push(`%${search}%`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const pagination = parsePagination(req.query, 4);

  if (!pagination.enabled) {
    const categories = await query(
      `SELECT * FROM categories ${whereSql} ORDER BY sortOrder ASC, id ASC`,
      params
    );
    return success(res, categories, 'Categories fetched successfully');
  }

  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM categories ${whereSql}`, params);
  const categories = await query(
    `SELECT * FROM categories ${whereSql} ORDER BY sortOrder ASC, id ASC LIMIT ? OFFSET ?`,
    [...params, pagination.limit, pagination.offset]
  );
  return success(res, categories, 'Categories fetched successfully', 200, {
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      hasMore: pagination.offset + categories.length < total,
    },
  });
});

router.get('/:id', async (req, res) => {
  const [category] = await query('SELECT * FROM categories WHERE id = ?', [req.params.id]);
  if (!category) return failure(res, 'Category not found', 404);
  return success(res, category, 'Category fetched successfully');
});

router.post('/', requireAdmin, requireJsonBody, async (req, res) => {
  const { name, description, image, imagePublicId, status, sortOrder } = req.body;
  if (!name || !name.trim()) {
    return failure(res, 'Category name is required', 400);
  }

  const result = await query(
    `INSERT INTO categories (name, description, image, imagePublicId, status, sortOrder)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      name.trim(),
      description || null,
      image || null,
      imagePublicId || null,
      status === undefined ? 1 : status ? 1 : 0,
      Number.isFinite(sortOrder) ? sortOrder : 0,
    ]
  );

  const [created] = await query('SELECT * FROM categories WHERE id = ?', [result.insertId]);
  return success(res, created, 'Category created successfully', 201);
});

router.put('/:id', requireAdmin, requireJsonBody, async (req, res) => {
  const { id } = req.params;
  const body = req.body;
  const [existing] = await query('SELECT * FROM categories WHERE id = ?', [id]);
  if (!existing) return failure(res, 'Category not found', 404);

  const name = body.name !== undefined ? body.name.trim() : existing.name;
  if (!name) return failure(res, 'Category name is required', 400);

  const description = body.description !== undefined ? body.description : existing.description;
  const image = body.image !== undefined ? body.image : existing.image;
  const imagePublicId = body.imagePublicId !== undefined ? body.imagePublicId : existing.imagePublicId;
  const status = body.status !== undefined ? (body.status ? 1 : 0) : existing.status;
  const sortOrder = body.sortOrder !== undefined ? body.sortOrder : existing.sortOrder;

  if (body.image !== undefined && existing.image && existing.imagePublicId && existing.imagePublicId !== imagePublicId) {
    await deleteImage(existing.imagePublicId);
  }

  await query(
    `UPDATE categories SET name = ?, description = ?, image = ?, imagePublicId = ?, status = ?, sortOrder = ? WHERE id = ?`,
    [name, description, image, imagePublicId, status, sortOrder, id]
  );

  const [updated] = await query('SELECT * FROM categories WHERE id = ?', [id]);
  return success(res, updated, 'Category updated successfully');
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const [existing] = await query('SELECT * FROM categories WHERE id = ?', [id]);
  if (!existing) return failure(res, 'Category not found', 404);

  const [{ count }] = await query('SELECT COUNT(*) as count FROM products WHERE categoryId = ?', [id]);
  if (count > 0) {
    return failure(res, 'Cannot delete a category that still has products. Move or delete its products first.', 409);
  }

  await query('DELETE FROM categories WHERE id = ?', [id]);
  if (existing.imagePublicId) await deleteImage(existing.imagePublicId);

  return success(res, null, 'Category deleted successfully');
});

export default router;
