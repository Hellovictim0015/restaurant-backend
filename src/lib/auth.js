import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';

export const AUTH_COOKIE_NAME = 'admin_token';
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function getSecretKey() {
  return new TextEncoder().encode(process.env.JWT_SECRET);
}

export function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

export function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export async function signAdminToken(admin) {
  return new SignJWT({ id: admin.id, email: admin.email, name: admin.name })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(getSecretKey());
}

export async function verifyAdminToken(token) {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    // Customer bearer tokens are signed with the same secret — never let one
    // pass as an admin session.
    if (payload.type === 'customer') return null;
    return payload;
  } catch {
    return null;
  }
}

export function setAuthCookie(res, token) {
  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: TOKEN_TTL_SECONDS * 1000,
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(AUTH_COOKIE_NAME, { path: '/' });
}

export async function getCurrentAdmin(req) {
  const token = req.cookies?.[AUTH_COOKIE_NAME];
  if (!token) return null;
  return verifyAdminToken(token);
}
