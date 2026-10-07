import { getCurrentAdmin } from '../lib/auth.js';
import { failure } from '../lib/response.js';

// Admin-only routes: requires a valid `admin_token` cookie (set by
// POST /api/auth/login). Public routes (menu, checkout, payment, customer
// auth) simply don't use this middleware.
export async function requireAdmin(req, res, next) {
  const admin = await getCurrentAdmin(req);
  if (!admin) return failure(res, 'Not authenticated', 401);
  req.admin = admin;
  next();
}
