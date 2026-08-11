import { createHash } from 'crypto';

/**
 * Deterministic Sals3 identity helpers.
 *
 * Everything here is a pure function of stable provider identifiers, which is
 * what makes the draft flow safely replayable: a retry, a duplicate click, or
 * an at-least-once queue redelivery derives the *same* SKU and the *same*
 * option-combination key, so the unique indexes turn a second attempt into a
 * no-op conflict instead of a second row. A random or timestamp-derived value
 * would defeat both.
 */

const SKU_PREFIX = 'S3V';
/** 12 hex chars ≈ 48 bits. Collisions are still caught by the unique index. */
const SKU_HASH_LENGTH = 12;

/**
 * The stable Sals3 SKU for one provider variant (spec §4.3: globally unique,
 * immutable after first publication, and *never* replaced with the CJ SKU).
 *
 * The NUL separator is not decoration: without it, `("AB","C")` and
 * `("A","BC")` would hash identically and two distinct CJ variants could
 * share one Sals3 SKU. It cannot occur inside a provider identifier.
 *
 * Derived from provider identity rather than from a title, label, or position,
 * because CJ reorders variants between responses and renames labels freely -
 * ADR-013 §7's "preserve Sals3 variant IDs when CJ labels or ordering change".
 */
export function deriveSals3Sku(input: {
  providerCode: string;
  externalProductId: string;
  externalVariantId: string;
}): string {
  const digest = createHash('sha256')
    .update(
      `${input.providerCode}\u0000${input.externalProductId}\u0000${input.externalVariantId}`,
    )
    .digest('hex')
    .slice(0, SKU_HASH_LENGTH)
    .toUpperCase();

  return `${SKU_PREFIX}-${digest}`;
}

/**
 * Case- and whitespace-folded key used for option/value uniqueness.
 *
 * Unicode-normalized first so `Café` and `Café` - identical on screen,
 * different byte sequences - cannot become two option values that render the
 * same and let a customer pick the wrong one.
 */
export function normalizeOptionToken(raw: string): string {
  return raw.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * The sorted, normalized rendering of a variant's option-value set, stored on
 * `product_variants.option_combination_key`.
 *
 * Sorted by option id so the key is independent of the order the pairs were
 * written in: `{colour:black, size:xl}` and `{size:xl, colour:black}` are the
 * same combination and must collide on the partial unique index, which is the
 * only thing actually enforcing spec §4.3's "no two active variants with the
 * same normalized option combination".
 *
 * Returns `null` for an empty set. That is not a shrug - an unmapped variant
 * has *no* combination, and the paired check constraint uses exactly that
 * `null` to make such a variant impossible to store as `ACTIVE`.
 */
export function buildOptionCombinationKey(
  pairs: readonly { optionId: string; normalizedValue: string }[],
): string | null {
  if (pairs.length === 0) return null;

  return [...pairs]
    .sort((left, right) => left.optionId.localeCompare(right.optionId))
    .map((pair) => `${pair.optionId}=${pair.normalizedValue}`)
    .join('&');
}

/**
 * Canonical SHA-256 of a request payload, for `idempotency_records`.
 *
 * Keys are sorted so two structurally identical requests that happen to
 * serialize their fields in a different order are recognised as the same
 * request rather than raising a spurious `IDEMPOTENCY_CONFLICT`.
 */
export function canonicalRequestHash(payload: Record<string, unknown>): string {
  const canonical = Object.keys(payload)
    .sort()
    .map((key) => `${key}=${JSON.stringify(payload[key] ?? null)}`)
    .join('&');

  return createHash('sha256').update(canonical).digest('hex');
}
