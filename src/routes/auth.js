import { Router } from 'express';
import { query } from '../lib/db.js';
import { verifyPassword, signAdminToken, setAuthCookie, clearAuthCookie, getCurrentAdmin } from '../lib/auth.js';
import { success, failure } from '../lib/response.js';
import { requireJsonBody } from '../middleware/body.js';

const router = Router();

router.post('/login', requireJsonBody, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return failure(res, 'Email and password are required', 400);
  }

  const rows = await query('SELECT * FROM admins WHERE email = ? LIMIT 1', [
    String(email).trim().toLowerCase(),
  ]);
  const admin = rows[0];
  if (!admin) {
    return failure(res, 'Invalid email or password', 401);
  }

  const isValid = await verifyPassword(password, admin.password);
  if (!isValid) {
    return failure(res, 'Invalid email or password', 401);
  }

  const token = await signAdminToken(admin);
  setAuthCookie(res, token);

  return success(res, { id: admin.id, name: admin.name, email: admin.email }, 'Logged in successfully');
});

router.post('/logout', (_req, res) => {
  clearAuthCookie(res);
  return success(res, null, 'Logged out successfully');
});

router.get('/me', async (req, res) => {
  const admin = await getCurrentAdmin(req);
  if (!admin) {
    return failure(res, 'Not authenticated', 401);
  }
  return success(res, admin, 'Authenticated');
});

export default router;
