/**
 * Page window for a count-then-fetch list view: the total row count comes
 * from SQL, so a page is expressed as `limit`/`offset` against the database
 * rather than by slicing an array already held in memory (`paginate()` in
 * `@/lib/products/catalog-filters` is the in-memory variant, and only fits
 * lists small enough to fetch whole - the candidate pipeline is not one,
 * with tens of thousands of rows in a single tab).
 */
export type PageWindow = {
  /** Clamped into range - never the raw `?page=` value. */
  page: number;
  totalPages: number;
  offset: number;
  pageSize: number;
  total: number;
};

/**
 * Parses a `?page=` value into a positive integer, defaulting to 1. A
 * non-numeric, zero, negative, or fractional value is not an error worth a
 * 400 on a list view - it just means page 1.
 */
export function parsePageParam(value: string | undefined): number {
  const parsed = Number(value);

  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : 1;
}

/**
 * Clamps the requested page into range in both directions, so a hand-typed
 * or stale `?page=9999` lands on the last page that actually has rows
 * instead of rendering an empty table that looks like "nothing here".
 * `totalPages` is at least 1 even for an empty result, so "Page 1 of 1" is
 * the empty case rather than "Page 1 of 0".
 */
export function resolvePageWindow(
  total: number,
  requestedPage: number,
  pageSize: number,
): PageWindow {
  const safeTotal = Math.max(total, 0);
  const safePageSize = Math.max(pageSize, 1);
  const totalPages = Math.max(1, Math.ceil(safeTotal / safePageSize));
  const page = Math.min(Math.max(requestedPage, 1), totalPages);

  return {
    page,
    totalPages,
    offset: (page - 1) * safePageSize,
    pageSize: safePageSize,
    total: safeTotal,
  };
}
