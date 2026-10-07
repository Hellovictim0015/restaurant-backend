import { Router } from 'express';
import { query, withTransaction } from '../lib/db.js';
import { success, failure } from '../lib/response.js';
import { requireAdmin } from '../middleware/auth.js';
import { requireJsonBody } from '../middleware/body.js';

const router = Router();

// Admin-only — the tiers are only ever read server-side inside
// lib/orderCalc.js, never by the Flutter app directly.
router.use(requireAdmin);

router.get('/', async (_req, res) => {
  const tiers = await query('SELECT * FROM delivery_charge_tiers ORDER BY upToKm ASC');
  return success(res, tiers, 'Delivery charge tiers fetched successfully');
});

// Replaces the whole tier list atomically — simpler and safer than diffing
// individual rows for a short admin-managed list like this.
router.put('/', requireJsonBody, async (req, res) => {
  const tiers = Array.isArray(req.body.tiers) ? req.body.tiers : null;
  if (!tiers) return failure(res, 'tiers must be an array', 400);

  const cleaned = [];
  for (const [index, tier] of tiers.entries()) {
    const upToKm = Number(tier.upToKm);
    const charge = Number(tier.charge);
    if (!Number.isFinite(upToKm) || upToKm <= 0) {
      return failure(res, `Tier #${index + 1}: enter a valid distance in km`, 400);
    }
    if (!Number.isFinite(charge) || charge < 0) {
      return failure(res, `Tier #${index + 1}: enter a valid charge`, 400);
    }
    cleaned.push({ upToKm, charge });
  }

  // No two tiers should share the same "up to" distance — ambiguous otherwise.
  const seenKm = new Set();
  for (const tier of cleaned) {
    if (seenKm.has(tier.upToKm)) {
      return failure(res, `Two tiers both use "${tier.upToKm} km" — each distance can only appear once`, 400);
    }
    seenKm.add(tier.upToKm);
  }

  cleaned.sort((a, b) => a.upToKm - b.upToKm);

  await withTransaction(async (txQuery) => {
    await txQuery('DELETE FROM delivery_charge_tiers');
    for (const [index, tier] of cleaned.entries()) {
      await txQuery(
        'INSERT INTO delivery_charge_tiers (upToKm, charge, sortOrder) VALUES (?, ?, ?)',
        [tier.upToKm, tier.charge, index]
      );
    }
  });

  const updated = await query('SELECT * FROM delivery_charge_tiers ORDER BY upToKm ASC');
  return success(res, updated, 'Delivery charge tiers updated successfully');
});

export default router;
