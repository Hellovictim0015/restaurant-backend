import { query, withTransaction } from './db.js';

// A submitted variant looks like { id?: number, name: string, price: number,
// status?: boolean, sortOrder?: number }. `id` is present only when editing an
// existing variant; omit it (or pass null) for a new one.
export function validateVariants(variants) {
  if (variants === undefined || variants === null) return [];
  if (!Array.isArray(variants)) {
    throw new Error('variants must be an array');
  }
  return variants.map((v, index) => {
    const name = typeof v.name === 'string' ? v.name.trim() : '';
    const price = Number(v.price);
    if (!name) throw new Error(`Variant #${index + 1} needs a name`);
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(`Variant "${name}" needs a valid price`);
    }
    return {
      id: v.id ? Number(v.id) : null,
      name,
      price,
      status: v.status === undefined ? 1 : v.status ? 1 : 0,
      sortOrder: Number.isFinite(Number(v.sortOrder)) ? Number(v.sortOrder) : index,
    };
  });
}

// Attaches a `variants` array (active + inactive, sorted) to each product row.
export async function attachVariants(products) {
  if (products.length === 0) return products;
  const ids = products.map((p) => p.id);
  const placeholders = ids.map(() => '?').join(',');
  const variants = await query(
    `SELECT * FROM product_variants WHERE productId IN (${placeholders}) ORDER BY sortOrder ASC, id ASC`,
    ids
  );
  const byProduct = new Map();
  for (const v of variants) {
    if (!byProduct.has(v.productId)) byProduct.set(v.productId, []);
    byProduct.get(v.productId).push(v);
  }
  return products.map((p) => ({ ...p, variants: byProduct.get(p.id) || [] }));
}

// Replaces a product's variant set: updates ones with a matching `id`,
// inserts new ones (no `id`), deletes any existing variant not present in
// `variants`. Runs in its own transaction.
export async function syncVariants(productId, variants) {
  await withTransaction(async (txQuery) => {
    const existing = await txQuery('SELECT id FROM product_variants WHERE productId = ?', [productId]);
    const existingIds = new Set(existing.map((v) => v.id));
    const keepIds = new Set(variants.filter((v) => v.id).map((v) => v.id));

    for (const id of existingIds) {
      if (!keepIds.has(id)) {
        await txQuery('DELETE FROM product_variants WHERE id = ?', [id]);
      }
    }

    for (const v of variants) {
      if (v.id && existingIds.has(v.id)) {
        await txQuery(
          'UPDATE product_variants SET name = ?, price = ?, status = ?, sortOrder = ? WHERE id = ?',
          [v.name, v.price, v.status, v.sortOrder, v.id]
        );
      } else {
        await txQuery(
          'INSERT INTO product_variants (productId, name, price, status, sortOrder) VALUES (?, ?, ?, ?, ?)',
          [productId, v.name, v.price, v.status, v.sortOrder]
        );
      }
    }
  });
}
