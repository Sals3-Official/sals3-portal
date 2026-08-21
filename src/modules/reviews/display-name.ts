import { REVIEW_DISPLAY_NAME_MAX_LENGTH } from './contracts';

/**
 * Turns a buyer's own account name into the string stored on their review.
 *
 * ## Masked at write time, not at read time
 *
 * The stored value is the *already-masked* string — "Hezekiah A." — and never
 * the full name. Two reasons, both about blast radius:
 *
 * 1. A read path cannot leak a surname it was never given. Every future
 *    consumer of `sals3_product_reviews` (the PDP, the Seller Center, a CSV
 *    export, JSON-LD) inherits the masking for free instead of each having to
 *    remember it.
 * 2. The masking is applied once, at the boundary where the buyer saw the
 *    string and chose it. What is stored is exactly what they consented to,
 *    which is a materially different claim from "what we think they'd accept".
 *
 * The trade-off, stated: the full name is unrecoverable from this table, so a
 * later decision to show more requires the buyer's account, not a migration
 * over stored reviews. That is the correct direction for the mistake to run in.
 *
 * ## What it does not try to do
 *
 * This is not anonymisation. "Hezekiah A." plus an order is still identifying
 * to anyone holding the order. It is the ordinary marketplace convention that
 * a review does not publish a full legal name, and nothing more.
 */

/**
 * The column's `CHECK` caps this, so a very long first name has to be cut
 * somewhere. Cut rather than reject: a buyer whose name does not fit is not an
 * error, and refusing their review over it would be absurd.
 */
function truncate(value: string): string {
  return Array.from(value).length <= REVIEW_DISPLAY_NAME_MAX_LENGTH
    ? value
    : Array.from(value).slice(0, REVIEW_DISPLAY_NAME_MAX_LENGTH).join('');
}

/**
 * `Hezekiah Aranador` becomes `Hezekiah A.`; a single-token name is returned
 * whole, because there is no surname to reduce and inventing an initial from
 * the only name a buyer gave would be worse than showing it.
 *
 * Returns `null` when there is no usable name at all, which callers must treat
 * as the anonymous case rather than substituting a placeholder.
 */
export default function maskDisplayName(fullName: string): string | null {
  const tokens = fullName
    .trim()
    .split(/\s+/u)
    .filter((token) => token !== '');

  if (tokens.length === 0) return null;

  const [first, ...rest] = tokens;

  if (first === undefined) return null;

  const last = rest.at(-1);

  // A single token, or a trailing token with no letters in it (a stray comma,
  // an emoji) — the initial would be meaningless, so the first name stands
  // alone rather than gaining a decorative full stop.
  if (last === undefined) return truncate(first);

  const initial = Array.from(last).find((character) =>
    /\p{L}/u.test(character),
  );

  if (initial === undefined) return truncate(first);

  return truncate(`${first} ${initial.toLocaleUpperCase()}.`);
}
