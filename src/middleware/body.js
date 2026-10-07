import { failure } from '../lib/response.js';

// Mirrors the old Next.js routes' `await request.json()` guard: a POST/PUT
// with a missing or non-object JSON body gets a 400 instead of crashing.
export function requireJsonBody(req, res, next) {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return failure(res, 'Invalid request body', 400);
  }
  next();
}
