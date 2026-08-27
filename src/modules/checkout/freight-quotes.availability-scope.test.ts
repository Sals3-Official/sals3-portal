// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import { loadQuoteLines } from './freight-quotes';

vi.mock('server-only', () => ({}));

/**
 * What a cart may be quoted for is a `WHERE` clause, so it is asserted as one.
 *
 * These render the real SQL Drizzle would send — `String(sqlObject)` renders
 * `"[object Object]"` and passes vacuously — because the failure this file
 * exists for was invisible to every behavioural test in
 * `freight-quotes.test.ts`: those stub the executor and hand back rows, so the
 * predicate that decides whether any row comes back at all is never exercised.
 *
 * The defect: `availability_state = 'AVAILABLE'`. That value is frozen onto the
 * offer at publish and only from a supplier observation under 72 hours old, and
 * nothing refreshes the observation afterwards. The 2026-08-27 catalogue-wide
 * republish therefore stored `UNKNOWN` on every published offer, this predicate
 * matched nothing, and every buyer — in every destination — was told "A cart
 * item is not available for delivery to this address". Stock is re-confirmed
 * against CJ's live inventory later in the same request, so the frozen flag was
 * costing correctness and buying nothing.
 */

const dialect = new PgDialect();

function recordingExecutor() {
  const rendered: string[] = [];

  function chain() {
    const builder: Record<string, unknown> = {};
    const self = (): unknown => builder;

    ['from', 'innerJoin', 'leftJoin', 'orderBy'].forEach((name) => {
      builder[name] = vi.fn(self);
    });
    builder.where = vi.fn((condition: SQL | undefined) => {
      rendered.push(
        condition === undefined ? '' : dialect.sqlToQuery(condition).sql,
      );

      return builder;
    });
    // Both quote queries end at `.limit(20)` and are awaited there.
    builder.limit = vi.fn(async () => []);

    return builder;
  }

  return { executor: { select: vi.fn(chain) }, rendered };
}

async function renderQuoteConditions(): Promise<string[]> {
  const { executor, rendered } = recordingExecutor();

  // No row comes back, so the load refuses the line. The refusal is the other
  // tests' subject; here it is only how the query gets built.
  await loadQuoteLines(
    {
      cart: {
        items: [{ productId: 'jacket', variantId: 'variant-1', quantity: 1 }],
      },
      address: {
        email: 'buyer@example.com',
        fullName: 'Buyer Example',
        addressLine1: '1 Martin Place',
        city: 'Sydney',
        region: 'NSW',
        postalCode: '2000',
        country: 'AU',
      },
    },
    executor as never,
  ).catch(() => undefined);

  return rendered;
}

const REQUIRED_CONDITIONS = [
  { label: 'product is published', fragment: `"publication_state" = ` },
  {
    label: 'product has a publication date',
    fragment: `"published_at" is not null`,
  },
  {
    label: 'offer is published',
    fragment: `"product_offers"."publish_state" = `,
  },
  {
    label: 'offer price is resolved',
    fragment: `"product_offers"."pricing_state" = `,
  },
  {
    label: 'offer carries an amount',
    fragment: `"price_amount_minor" is not null`,
  },
  { label: 'offer is dropshipped', fragment: `"fulfillment_mode" = ` },
];

describe('loadQuoteLines offer scope', () => {
  it.each(REQUIRED_CONDITIONS)(
    'requires in both query paths that the $label',
    async ({ fragment }) => {
      const rendered = await renderQuoteConditions();

      expect(rendered).toHaveLength(2);
      rendered.forEach((sql) => expect(sql).toContain(fragment));
    },
  );

  it('refuses a supplier-confirmed unavailable offer', async () => {
    const rendered = await renderQuoteConditions();

    rendered.forEach((sql) =>
      expect(sql).toContain(`"product_offers"."availability_state" <> `),
    );
  });

  /**
   * The regression guard. `= 'AVAILABLE'` reads as caution and behaves as an
   * outage: an offer whose stock was last observed more than 72 hours before it
   * was published can never satisfy it, however well stocked the item actually
   * is.
   */
  it('does not require the frozen AVAILABLE claim', async () => {
    const rendered = await renderQuoteConditions();

    rendered.forEach((sql) =>
      expect(sql).not.toContain(`"product_offers"."availability_state" = `),
    );
  });

  /**
   * Both paths are market-agnostic on purpose: an offer priced for one
   * destination still quotes to another, and `chooseOfferForDestination` only
   * *prefers* the destination's own offer when sorting. A `market_code`
   * predicate here would refuse the cart outright — with a sentence blaming the
   * buyer's address, which is how the frozen availability flag was misread for
   * a delivery restriction in the first place.
   */
  it('filters on no market code', async () => {
    const rendered = await renderQuoteConditions();

    rendered.forEach((sql) => expect(sql).not.toContain('market_code'));
  });
});
