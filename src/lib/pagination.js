// Pagination is opt-in: a request with no `page`/`limit` query params gets the
// full unpaginated list (existing behavior — the admin dashboard relies on this).
// Passing either param switches the endpoint into paginated mode.
export function parsePagination(queryParams, defaultLimit = 10, maxLimit = 50) {
  const rawPage = queryParams.page;
  const rawLimit = queryParams.limit;
  const enabled = rawPage !== undefined || rawLimit !== undefined;
  if (!enabled) return { enabled: false };

  const page = Math.max(1, parseInt(rawPage, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(rawLimit, 10) || defaultLimit));
  return { enabled: true, page, limit, offset: (page - 1) * limit };
}
