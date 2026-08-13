/**
 * Public product slugs.
 *
 * ## Derived from the title, never from the supplier id
 *
 * The retired CJ-backed feed built its slug from `product.id || product.sku` —
 * the CJ `pid` — so every public URL leaked a supplier identifier and changed
 * meaning if the product was ever re-sourced. `products.title` is the
 * Sals3-owned editorial field (seeded from CJ as a draft suggestion, ours from
 * then on), which makes the slug ours too.
 *
 * ## The regex is load-bearing
 *
 * `sals3-ecommerce`'s response schema validates `slug` against
 * `^[a-z0-9]+(?:-[a-z0-9]+)*$` and **drops the whole page** on a miss. So a
 * slug that cannot satisfy `isPublicSlug` must never be written, and
 * `publishProduct` refuses rather than storing one.
 */

/** Same pattern the storefront consumer applies. */
const PUBLIC_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Well under the consumer's 120-character `id` cap, and short enough to stay
 * readable in a shared link. Truncation lands on a hyphen boundary so a slug
 * never ends mid-word.
 */
const MAX_SLUG_LENGTH = 80;

/** How many numeric suffixes to try before falling back to the id suffix. */
const MAX_NUMBERED_ATTEMPTS = 5;

export function isPublicSlug(value: string): boolean {
  return value.length <= MAX_SLUG_LENGTH && PUBLIC_SLUG_PATTERN.test(value);
}

function truncateOnBoundary(value: string): string {
  if (value.length <= MAX_SLUG_LENGTH) return value;

  const clipped = value.slice(0, MAX_SLUG_LENGTH);
  const lastHyphen = clipped.lastIndexOf('-');

  // Only cut back to a hyphen when doing so leaves something worth reading;
  // a title whose first word is longer than the cap keeps its hard truncation.
  return lastHyphen > MAX_SLUG_LENGTH / 2
    ? clipped.slice(0, lastHyphen)
    : clipped.replace(/-+$/, '');
}

/**
 * The base slug for a title, or `''` when the title has no characters the
 * pattern permits — a CJK-only or punctuation-only title, both of which are
 * real for a CJ-sourced product.
 */
export function slugBaseFromTitle(title: string): string {
  const normalized = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return truncateOnBoundary(normalized);
}

/**
 * Slugs to try, in order, for one product.
 *
 * The last entry is always id-suffixed, so the ladder cannot be exhausted by
 * collisions on a common title — and a title that reduces to nothing still
 * gets a stable, unique URL rather than a bare `product` that every such
 * product would fight over.
 *
 * Intended use is insert-and-catch on `products_public_slug_key`: checking
 * availability first and then writing is a race two concurrent publishes both
 * pass.
 */
export function candidateSlugsFromTitle(
  title: string,
  productId: string,
): string[] {
  const base = slugBaseFromTitle(title);
  // A uuid's first segment: 8 hex characters, enough to disambiguate and
  // already lowercase alphanumeric, so it cannot break the pattern.
  const idSuffix = productId
    .replace(/[^a-z0-9]/gi, '')
    .slice(0, 8)
    .toLowerCase();
  const fallback = idSuffix === '' ? 'product' : `product-${idSuffix}`;

  if (base === '') return [fallback];

  /**
   * Suffixes are budgeted, not appended and hoped for. A base at the length
   * cap plus `-2` exceeds it, `isPublicSlug` would reject the result, and the
   * ladder would silently lose entries — including, at worst, its own
   * guaranteed-unique last one.
   */
  const withSuffix = (suffix: string): string =>
    `${base.slice(0, MAX_SLUG_LENGTH - suffix.length - 1).replace(/-+$/, '')}-${suffix}`;

  const numbered = Array.from(
    { length: MAX_NUMBERED_ATTEMPTS - 1 },
    (_, index) => withSuffix(String(index + 2)),
  );
  const unique = idSuffix === '' ? fallback : withSuffix(idSuffix);

  return [base, ...numbered, unique].filter(isPublicSlug);
}
