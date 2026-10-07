import { Router } from 'express';
import { query } from '../lib/db.js';
import { success, failure } from '../lib/response.js';
import { parsePagination } from '../lib/pagination.js';
import { deleteImage } from '../lib/cloudinary.js';
import { validateVariants, attachVariants, syncVariants } from '../lib/productVariants.js';
import { requireAdmin } from '../middleware/auth.js';
import { requireJsonBody } from '../middleware/body.js';

const router = Router();

// Public. Filters: ?categoryId=, ?search=, ?status=active|inactive,
// ?available=1 (only in-stock items).
router.get('/', async (req, res) => {
  const { categoryId, search, status, available } = req.query;

  const where = [];
  const params = [];
  if (categoryId) {
    where.push('p.categoryId = ?');
    params.push(categoryId);
  }
  if (search) {
    where.push('p.name LIKE ?');
    params.push(`%${search}%`);
  }
  if (status === 'active') {
    where.push('p.status = 1');
  } else if (status === 'inactive') {
    where.push('p.status = 0');
  }
  if (available === '1' || available === 'true') {
    where.push('p.isAvailable = 1');
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const pagination = parsePagination(req.query, 10);

  if (!pagination.enabled) {
    const products = await query(
      `SELECT p.*, c.name AS categoryName FROM products p
       LEFT JOIN categories c ON c.id = p.categoryId
       ${whereSql} ORDER BY p.createdAt DESC`,
      params
    );
    return success(res, await attachVariants(products), 'Products fetched successfully');
  }

  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM products p ${whereSql}`, params);
  const products = await query(
    `SELECT p.*, c.name AS categoryName FROM products p
     LEFT JOIN categories c ON c.id = p.categoryId
     ${whereSql} ORDER BY p.createdAt DESC LIMIT ? OFFSET ?`,
    [...params, pagination.limit, pagination.offset]
  );
  return success(res, await attachVariants(products), 'Products fetched successfully', 200, {
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      hasMore: pagination.offset + products.length < total,
    },
  });
});

router.get('/:id', async (req, res) => {
  const [product] = await query(
    `SELECT p.*, c.name AS categoryName FROM products p LEFT JOIN categories c ON c.id = p.categoryId WHERE p.id = ?`,
    [req.params.id]
  );
  if (!product) return failure(res, 'Product not found', 404);
  const [withVariants] = await attachVariants([product]);
  return success(res, withVariants, 'Product fetched successfully');
});

// A product either has a flat `price`, or one or more `variants` (e.g.
// "8 pcs" ₹100, "10 pcs" ₹150) — provide at least one of the two.
router.post('/', requireAdmin, requireJsonBody, async (req, res) => {
  const body = req.body;
  const { categoryId, name, description, price, image, imagePublicId, status, isAvailable } = body;

  if (!categoryId) return failure(res, 'Category is required', 400);
  if (!name || !name.trim()) return failure(res, 'Product name is required', 400);

  let variants;
  try {
    variants = validateVariants(body.variants);
  } catch (error) {
    return failure(res, error.message, 400);
  }

  const hasPrice = price !== undefined && price !== null && price !== '';
  const numericPrice = hasPrice ? Number(price) : null;
  if (hasPrice && (!Number.isFinite(numericPrice) || numericPrice <= 0)) {
    return failure(res, 'A valid price is required', 400);
  }
  if (!hasPrice && variants.length === 0) {
    return failure(res, 'Set a price, or add at least one variant (e.g. "8 pcs" — ₹100)', 400);
  }

  const [category] = await query('SELECT id FROM categories WHERE id = ?', [categoryId]);
  if (!category) return failure(res, 'Selected category does not exist', 400);

  const result = await query(
    `INSERT INTO products (categoryId, name, description, price, image, imagePublicId, status, isAvailable)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      categoryId,
      name.trim(),
      description || null,
      numericPrice,
      image || null,
      imagePublicId || null,
      status === undefined ? 1 : status ? 1 : 0,
      isAvailable === undefined ? 1 : isAvailable ? 1 : 0,
    ]
  );

  if (variants.length > 0) {
    await syncVariants(result.insertId, variants);
  }

  const [created] = await query('SELECT * FROM products WHERE id = ?', [result.insertId]);
  const [withVariants] = await attachVariants([created]);
  return success(res, withVariants, 'Product created successfully', 201);
});

router.put('/:id', requireAdmin, requireJsonBody, async (req, res) => {
  const { id } = req.params;
  const body = req.body;
  const [existing] = await query('SELECT * FROM products WHERE id = ?', [id]);
  if (!existing) return failure(res, 'Product not found', 404);

  const name = body.name !== undefined ? body.name.trim() : existing.name;
  if (!name) return failure(res, 'Product name is required', 400);

  let variants = null; // null = not touching variants this request
  if (body.variants !== undefined) {
    try {
      variants = validateVariants(body.variants);
    } catch (error) {
      return failure(res, error.message, 400);
    }
  }

  let price = existing.price;
  if (body.price !== undefined) {
    const clearingPrice = body.price === null || body.price === '';
    if (clearingPrice) {
      price = null;
    } else {
      const numericPrice = Number(body.price);
      if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
        return failure(res, 'A valid price is required', 400);
      }
      price = numericPrice;
    }
  }

  const [{ existingVariantCount }] = await query(
    'SELECT COUNT(*) AS existingVariantCount FROM product_variants WHERE productId = ?',
    [id]
  );
  const finalVariantCount = variants !== null ? variants.length : existingVariantCount;
  if (price === null && finalVariantCount === 0) {
    return failure(res, 'Set a price, or add at least one variant (e.g. "8 pcs" — ₹100)', 400);
  }

  let categoryId = existing.categoryId;
  if (body.categoryId !== undefined) {
    const [category] = await query('SELECT id FROM categories WHERE id = ?', [body.categoryId]);
    if (!category) return failure(res, 'Selected category does not exist', 400);
    categoryId = body.categoryId;
  }

  const description = body.description !== undefined ? body.description : existing.description;
  const image = body.image !== undefined ? body.image : existing.image;
  const imagePublicId = body.imagePublicId !== undefined ? body.imagePublicId : existing.imagePublicId;
  const status = body.status !== undefined ? (body.status ? 1 : 0) : existing.status;
  const isAvailable = body.isAvailable !== undefined ? (body.isAvailable ? 1 : 0) : existing.isAvailable;

  if (body.image !== undefined && existing.imagePublicId && existing.imagePublicId !== imagePublicId) {
    await deleteImage(existing.imagePublicId);
  }

  await query(
    `UPDATE products SET categoryId = ?, name = ?, description = ?, price = ?, image = ?, imagePublicId = ?, status = ?, isAvailable = ? WHERE id = ?`,
    [categoryId, name, description, price, image, imagePublicId, status, isAvailable, id]
  );

  if (variants !== null) {
    await syncVariants(id, variants);
  }

  const [updated] = await query('SELECT * FROM products WHERE id = ?', [id]);
  const [withVariants] = await attachVariants([updated]);
  return success(res, withVariants, 'Product updated successfully');
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const [existing] = await query('SELECT * FROM products WHERE id = ?', [id]);
  if (!existing) return failure(res, 'Product not found', 404);

  const [{ count }] = await query('SELECT COUNT(*) as count FROM order_items WHERE productId = ?', [id]);
  if (count > 0) {
    return failure(res, 'Cannot delete a product that appears in past orders. Disable it instead.', 409);
  }

  await query('DELETE FROM products WHERE id = ?', [id]);
  if (existing.imagePublicId) await deleteImage(existing.imagePublicId);

  return success(res, null, 'Product deleted successfully');
});

export default router;
