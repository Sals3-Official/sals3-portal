// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Where the freeze happens, asserted on the source.
 *
 * `createCheckoutIntent` has no behavioural test in this repository — it reaches
 * CJ freight, the token manager and a governed fetch, and nothing here fakes
 * that chain today. That gap predates this change, and it is exactly why the one
 * property that must not regress is pinned here instead of assumed: **the
 * listing is captured at intent creation, and acceptance only copies it.**
 *
 * If acceptance ever re-derived the snapshot, a seller edit landing between
 * payment and webhook delivery would rewrite the order — which is the whole
 * defect this feature exists to prevent, in a window nobody would think to test.
 *
 * The pure capture itself is covered by `listing-snapshot.test.ts`, and the read
 * side by `orders/buyer-read.test.ts`.
 */
const ORDERS_SOURCE = readFileSync('src/modules/checkout/orders.ts', 'utf8');

function sectionOf(name: string): string {
  const start = ORDERS_SOURCE.indexOf(`export async function ${name}`);
  const from = start === -1 ? ORDERS_SOURCE.indexOf(`function ${name}`) : start;

  expect(from).toBeGreaterThan(-1);

  const next = ORDERS_SOURCE.indexOf('\nfunction ', from + 1);
  const nextExported = ORDERS_SOURCE.indexOf(
    '\nexport async function',
    from + 1,
  );
  const ends = [next, nextExported].filter((index) => index > -1);

  return ORDERS_SOURCE.slice(
    from,
    ends.length === 0 ? undefined : Math.min(...ends),
  );
}

describe('listing snapshot capture site', () => {
  it('captures the listing while creating the intent', () => {
    expect(sectionOf('createCheckoutIntent')).toContain('loadListingSnapshots');
  });

  it('stores it on the cart snapshot, beside the line it describes', () => {
    expect(sectionOf('createCheckoutIntent')).toContain('listingSnapshot');
  });

  /**
   * Acceptance runs after payment. Re-reading the catalogue there would mean an
   * edit made during the Stripe round trip decided what the order says was
   * bought.
   */
  it('does not re-read the catalogue at acceptance', () => {
    const acceptance = sectionOf('snapshotLines');

    expect(acceptance).toContain('listingSnapshot');
    expect(acceptance).not.toContain('loadListingSnapshots');
    expect(acceptance).not.toContain('findPublishedProductBySlug');
  });

  /**
   * A snapshot shape this deployment does not recognise must not fail acceptance
   * of an order the buyer has already paid for — it is validated on the way out,
   * not on the way in.
   */
  it('parses the stored snapshot loosely at acceptance', () => {
    expect(sectionOf('snapshotLines')).toContain('z.unknown()');
  });
});
