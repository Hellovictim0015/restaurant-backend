import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days — mobile app, no refresh flow yet

function getSecretKey() {
  return new TextEncoder().encode(process.env.JWT_SECRET);
}

export async function signCustomerToken(customer) {
  return new SignJWT({ id: customer.id, email: customer.email, type: 'customer' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(getSecretKey());
}

async function verifyCustomerToken(token) {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if (payload.type !== 'customer') return null;
    return payload;
  } catch {
    return null;
  }
}

// Reads `Authorization: Bearer <token>` — customer auth uses a bearer token
// (not a cookie) since the client is a mobile app, not a browser.
export async function getCustomerFromRequest(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  return verifyCustomerToken(token);
}

export function generateOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
}

export function hashOtpCode(code) {
  return bcrypt.hash(code, 10);
}

export function verifyOtpCode(code, hash) {
  return bcrypt.compare(code, hash);
}
