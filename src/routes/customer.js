import { Router } from 'express';
import { query } from '../lib/db.js';
import { success, failure } from '../lib/response.js';
import {
  generateOtpCode,
  hashOtpCode,
  verifyOtpCode,
  signCustomerToken,
  getCustomerFromRequest,
} from '../lib/customerAuth.js';
import { sendOtpEmail } from '../lib/mailer.js';
import { requireJsonBody } from '../middleware/body.js';

const router = Router();

const OTP_TTL_MINUTES = 10;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_ATTEMPTS = 5;

// Play Store / App Store review accounts — reviewers can't receive real
// emails, so this fixed email always gets this fixed code instead of a real
// one being sent. Not a security risk beyond a throwaway test login: it's
// just a normal customer account like any other, no special privileges.
const REVIEWER_EMAIL = 'reviewer@test.com';
const REVIEWER_OTP_CODE = '123456';

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function publicProfile(customer) {
  return { id: customer.id, name: customer.name, email: customer.email, points: customer.points };
}

router.post('/auth/request-otp', requireJsonBody, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!isValidEmail(email)) {
    return failure(res, 'Enter a valid email address', 400);
  }

  // `secondsSinceLast` computed by MySQL itself (TIMESTAMPDIFF against its own
  // NOW()) — never compare a DB timestamp against `Date.now()` in JS, see
  // lib/db.js for why that silently breaks across server timezones.
  const [recent] = await query(
    `SELECT *, TIMESTAMPDIFF(SECOND, createdAt, NOW()) AS secondsSinceLast
     FROM email_otps WHERE email = ? ORDER BY id DESC LIMIT 1`,
    [email]
  );
  if (recent && recent.secondsSinceLast < RESEND_COOLDOWN_SECONDS) {
    return failure(
      res,
      `Please wait ${Math.ceil(RESEND_COOLDOWN_SECONDS - recent.secondsSinceLast)}s before requesting another code`,
      429
    );
  }

  const isReviewerAccount = email === REVIEWER_EMAIL;
  const code = isReviewerAccount ? REVIEWER_OTP_CODE : generateOtpCode();
  const codeHash = await hashOtpCode(code);

  await query(`UPDATE email_otps SET consumed = 1 WHERE email = ? AND consumed = 0`, [email]);
  await query(
    `INSERT INTO email_otps (email, codeHash, expiresAt) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
    [email, codeHash, OTP_TTL_MINUTES]
  );

  if (!isReviewerAccount) {
    try {
      await sendOtpEmail(email, code);
    } catch (error) {
      console.error('Failed to send OTP email:', error);
      return failure(res, 'Unable to send the login code right now. Please try again shortly.', 502);
    }
  }

  return success(res, { email }, 'A login code has been sent to your email');
});

router.post('/auth/verify-otp', requireJsonBody, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const code = String(req.body.code || '').trim();
  if (!email || !code) {
    return failure(res, 'Email and code are required', 400);
  }

  // `isExpired` is computed by MySQL itself (expiresAt vs its own NOW()) so
  // this is correct regardless of the app server's system timezone.
  const [otp] = await query(
    `SELECT *, (expiresAt < NOW()) AS isExpired FROM email_otps WHERE email = ? AND consumed = 0 ORDER BY id DESC LIMIT 1`,
    [email]
  );

  if (!otp) {
    return failure(res, 'No active login code for this email. Please request a new one.', 400);
  }
  if (Number(otp.isExpired) === 1) {
    return failure(res, 'This code has expired. Please request a new one.', 400);
  }
  if (otp.attempts >= MAX_ATTEMPTS) {
    return failure(res, 'Too many incorrect attempts. Please request a new code.', 429);
  }

  const isValid = await verifyOtpCode(code, otp.codeHash);
  if (!isValid) {
    await query(`UPDATE email_otps SET attempts = attempts + 1 WHERE id = ?`, [otp.id]);
    return failure(res, 'Incorrect code. Please try again.', 400);
  }

  await query(`UPDATE email_otps SET consumed = 1 WHERE id = ?`, [otp.id]);

  await query(
    `INSERT INTO customers (email) VALUES (?) ON DUPLICATE KEY UPDATE email = VALUES(email)`,
    [email]
  );
  const [customer] = await query('SELECT * FROM customers WHERE email = ?', [email]);

  const token = await signCustomerToken(customer);

  return success(res, { token, customer: publicProfile(customer) }, 'Logged in successfully');
});

router.get('/me', async (req, res) => {
  const auth = await getCustomerFromRequest(req);
  if (!auth) return failure(res, 'Not authenticated', 401);

  const [customer] = await query('SELECT * FROM customers WHERE id = ?', [auth.id]);
  if (!customer) return failure(res, 'Account not found', 404);

  return success(res, publicProfile(customer), 'Profile fetched successfully');
});

router.put('/me', requireJsonBody, async (req, res) => {
  const auth = await getCustomerFromRequest(req);
  if (!auth) return failure(res, 'Not authenticated', 401);

  const name = typeof req.body.name === 'string' ? req.body.name.trim() : undefined;
  if (name !== undefined && !name) {
    return failure(res, 'Name cannot be empty', 400);
  }

  if (name !== undefined) {
    await query('UPDATE customers SET name = ? WHERE id = ?', [name, auth.id]);
  }

  const [customer] = await query('SELECT * FROM customers WHERE id = ?', [auth.id]);
  if (!customer) return failure(res, 'Account not found', 404);
  return success(res, publicProfile(customer), 'Profile updated successfully');
});

export default router;
