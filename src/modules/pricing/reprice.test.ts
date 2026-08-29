// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

const { resolveProductPricingMock } = vi.hoisted(() => ({
  resolveProductPricingMock: vi.fn(),
}));

vi.mock('./resolver', () => ({
  resolveProductPricing: resolveProductPricingMock,
}));

/* eslint-disable import/first */
import {
  MAX_REPRICE_OFFERS,
  planReprice,
  writeReprice,
  type RepriceLine,
} from './reprice';

const dialect = new PgDialect();
const SELLER_ID = '11111111-1111-4111-a111-111111111111';

type Recorded = { rendered: string; params: unknown[] };

/**
 * The scope every run needs. Its own constant because a plan cannot be built
 * without one any more, and a literal repeated in thirty cases would make the
 * scope look like part of each test rather than a precondition of all of them.
 */
const SCOPE = {
  categoryCode: 'CAT-GGL-1',
  marketCode: 'AU',
  afterSku: null,
} as const;

/** The department the scope's code resolves to. Its subtree is what a run covers. */
const CATEGORY_PATH = 'Apparel & Accessories';

/**
 * A chainable stand-in for the query builder, recording the `WHERE` it was given.
 *
 * `planReprice` issues two selects now — the category path, then the candidates
 * — so this answers them in order rather than handing the same rows to both.
 * `categoryRows` defaults to a found category; pass `[]` to exercise the
 * unknown-code path.
 */
function recordingExecutor(
  rows: unknown[],
  categoryRows: unknown[] = [{ path: CATEGORY_PATH }],
) {
  const recorded: Recorded[] = [];
  const orderedBy: number[] = [];
  const answers = [categoryRows, rows];
  let call = -1;

  const builder: Record<string, unknown> = {};
  const self = (): unknown => builder;

  ['from', 'innerJoin', 'leftJoin', 'limit'].forEach((name) => {
    builder[name] = vi.fn(self);
  });
  // Recorded separately: the ordering is what makes a cursor resumable, and it
  // does not appear in the rendered `WHERE` the other assertions read.
  builder.orderBy = vi.fn((...columns: unknown[]) => {
    orderedBy.push(columns.length);

    return builder;
  });
  builder.where = vi.fn((condition: SQL | undefined) => {
    const query =
      condition === undefined
        ? { sql: '', params: [] }
        : dialect.sqlToQuery(condition);

    // Params as well as SQL: the rendered string carries `$1` placeholders, so
    // the pattern a LIKE actually matches on is only visible here.
    recorded.push({ rendered: query.sql, params: query.params });

    return builder;
  });
  builder.then = (resolve: (value: unknown) => unknown) =>
    resolve(answers[call] ?? rows);

  return {
    executor: {
      select: vi.fn(() => {
        call += 1;
        return builder;
      }),
    },
    recorded,
    orderedBy,
  };
}

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    offerId: 'offer-1',
    offerVersion: 3,
    marketCode: 'AU',
    currentPriceMinor: BigInt(2399),
    currentPriceCurrency: 'USD',
    pricingDecision: { resolvedLayer: 'CATEGORY' },
    pricingResolverVersion: 'pricing-resolver-v3',
    variantId: 'variant-1',
    sku: 'SALS3-1',
    productId: 'product-1',
    productTitle: 'Corduroy jacket',
    categoryCode: 'CAT-GGL-1',
    categoryConfidence: 'EXACT',
    supplierCandidateId: 'candidate-1',
    supplierVariantId: 'cj-variant-1',
    costMinor: 580,
    costCurrency: 'USD',
    observedAt: new Date('2026-08-28T00:00:00.000Z'),
    ...overrides,
  };
}

function resolved(amountMinor: number) {
  return {
    outcome: 'PRODUCT_MARGIN_ESTIMATE',
    resolvedLayer: 'CATEGORY',
    resolverVersion: 'pricing-resolver-v3',
    roundedSuggestedItemPrice: { amountMinor, currency: 'USD' },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('planReprice', () => {
  it('reads only this seller’s published offers', async () => {
    const { executor, recorded } = recordingExecutor([]);

    await planReprice(executor as never, SELLER_ID, SCOPE);

    // Two selects now: the category path, then the candidates.
    expect(recorded).toHaveLength(2);
    expect(recorded[1].rendered).toContain('"seller_account_id" = ');
    expect(recorded[1].rendered).toContain('"publish_state" = ');
  });

  /**
   * The scope, and the three ways it can be got wrong.
   *
   * The unscoped run this replaced took every published offer ordered by title
   * and kept the first 500, with no cursor — so it returned the same 500 on
   * every run and everything past the 500th product alphabetically had never
   * been repriceable. On a catalogue heading for millions of listings the fix
   * is not a larger cap; it is a run bounded by the rule that changed.
   */
  it('covers the category and its subtree, not the node alone', async () => {
    // `findNearestActiveCategoryPolicy` walks upward, so a markup on a
    // department prices everything under it. A run that matched only the node
    // would leave behind exactly the products the edited rule governs.
    const { executor, recorded } = recordingExecutor([]);

    await planReprice(executor as never, SELLER_ID, SCOPE);

    expect(recorded[1].rendered).toContain('"path" = ');
    expect(recorded[1].rendered).toContain('"path" like ');
  });

  it('matches the subtree on the separator, not a bare prefix', async () => {
    // Without the ' > ', a department named `Shoes` would also match
    // `Shoes & Boots` — repricing a sibling the edited rule never touched.
    const { executor, recorded } = recordingExecutor([]);

    await planReprice(executor as never, SELLER_ID, SCOPE);

    expect(recorded[1].params).toContain(`${CATEGORY_PATH} > %`);
    expect(recorded[1].params).not.toContain(`${CATEGORY_PATH}%`);
  });

  it('reads the path from the code rather than trusting a caller for both', async () => {
    // A caller allowed to supply both could send a code and a path that
    // disagree, repricing one category under the name of another.
    const { executor, recorded } = recordingExecutor([]);

    await planReprice(executor as never, SELLER_ID, SCOPE);

    expect(recorded[0].rendered).toContain('"code" = ');
  });

  it('an unknown category prices nothing rather than everything', async () => {
    /*
      The failure mode worth naming: an unresolved code must not fall through to
      a query with no category filter. `sals3_categories` is reference data every
      seller shares, so a code that does not resolve is a stale screen or a
      crafted payload — neither is an instruction to reprice the catalogue.
    */
    const { executor, recorded } = recordingExecutor([candidate()], []);

    const plan = await planReprice(executor as never, SELLER_ID, SCOPE);

    expect(plan.lines).toEqual([]);
    expect(plan.candidateCount).toBe(0);
    // The candidate query was never issued at all.
    expect(recorded).toHaveLength(1);
  });

  /**
   * The failure this closes, observed in production on 2026-08-30.
   *
   * A reclaim of Apparel & Accessories in AU covered 500 offers, left whatever
   * sat past them untouched, and then reported "every live price already
   * matches your rules". The scope had made the page smaller but not finite:
   * nothing excluded the rows already seen, so every run returned the same
   * page, and the dialog's advice to run it again could not reach the rest.
   */
  it('starts at the beginning when no position is given', async () => {
    const { executor, recorded } = recordingExecutor([]);

    await planReprice(executor as never, SELLER_ID, SCOPE);

    expect(recorded[1].rendered).not.toContain('"sals3_sku" > ');
  });

  it('asks for the rows strictly after a position, so none is priced twice', async () => {
    const { executor, recorded } = recordingExecutor([]);

    await planReprice(executor as never, SELLER_ID, {
      ...SCOPE,
      afterSku: 'S3V-0223B0F67DCC',
    });

    expect(recorded[1].rendered).toContain('"sals3_sku" > ');
    expect(recorded[1].params).toContain('S3V-0223B0F67DCC');
  });

  it('orders by the SKU, which is the thing a position can name', async () => {
    /*
      It ordered by `(title, sku)`, which reads better and cannot be resumed
      from one value: continuing after a title needs the pair, and a pair
      comparison written as two ANDed inequalities silently skips rows.
    */
    const { executor, orderedBy } = recordingExecutor([]);

    await planReprice(executor as never, SELLER_ID, SCOPE);

    // One column, not two. A pair cannot be resumed from a single value.
    expect(orderedBy).toEqual([1]);
  });

  it('reports the SKU the page ended on, taken from the covered rows', async () => {
    /*
      Not from `loaded`, which carries one extra row solely to detect that more
      exist. Resuming from the extra row would skip it — the one row nobody
      would ever notice was missing.
    */
    const rows = Array.from({ length: MAX_REPRICE_OFFERS + 1 }, (_, index) =>
      candidate({
        offerId: `offer-${index}`,
        sku: `SKU-${String(index).padStart(4, '0')}`,
      }),
    );
    const { executor } = recordingExecutor(rows);
    resolveProductPricingMock.mockResolvedValue(resolved(2399));

    const plan = await planReprice(executor as never, SELLER_ID, SCOPE);

    expect(plan.truncated).toBe(true);
    expect(plan.nextAfterSku).toBe(
      `SKU-${String(MAX_REPRICE_OFFERS - 1).padStart(4, '0')}`,
    );
  });

  it('reports no next position when the page was the last one', async () => {
    // `null` is what lets the screen say "this scope is finished" rather than
    // leaving the caller to infer it from a count.
    const { executor } = recordingExecutor([candidate()]);
    resolveProductPricingMock.mockResolvedValue(resolved(2399));

    const plan = await planReprice(executor as never, SELLER_ID, SCOPE);

    expect(plan.truncated).toBe(false);
    expect(plan.nextAfterSku).toBeNull();
  });

  it('reads Global as every destination with no rule of its own', async () => {
    /*
      `null` is not a wildcard. The Global rule prices offers into every country
      without a column of its own, so this selects the offers that rule would
      govern. No filter at all would let a Global run overwrite Australia's
      prices with Global's rule.
    */
    const { executor, recorded } = recordingExecutor([]);

    await planReprice(executor as never, SELLER_ID, {
      categoryCode: 'CAT-GGL-1',
      marketCode: null,
      afterSku: null,
    });

    expect(recorded[1].rendered).toContain('"market_code" not in ');
  });

  it('reads a named destination as that destination alone', async () => {
    const { executor, recorded } = recordingExecutor([]);

    await planReprice(executor as never, SELLER_ID, SCOPE);

    expect(recorded[1].rendered).toContain('"market_code" = ');
    expect(recorded[1].rendered).not.toContain('not in');
  });

  it('marks an offer whose rules now say a different number', async () => {
    const { executor } = recordingExecutor([candidate()]);
    resolveProductPricingMock.mockResolvedValue(resolved(2999));

    const plan = await planReprice(executor as never, SELLER_ID, SCOPE);

    expect(plan.counts).toMatchObject({ changed: 1, unchanged: 0 });
    expect(plan.lines[0]).toMatchObject({
      status: 'CHANGED',
      currentPriceMinor: 2399,
      newPriceMinor: 2999,
      newPriceCurrency: 'USD',
    });
  });

  it('leaves an offer alone when the rules still say what it already carries', async () => {
    const { executor } = recordingExecutor([candidate()]);
    resolveProductPricingMock.mockResolvedValue(resolved(2399));

    const plan = await planReprice(executor as never, SELLER_ID, SCOPE);

    expect(plan.counts).toMatchObject({ changed: 0, unchanged: 1 });
    expect(plan.lines[0].newPriceMinor).toBeNull();
  });

  /**
   * The case that would otherwise destroy a deliberate decision.
   *
   * `publishProduct` lets a seller type a retail price, which skips the
   * resolver and stamps `SELLER_RETAIL_PRICE`. Repricing that offer would
   * replace a number a person chose with one a rule computed, silently, in a
   * bulk action — so the resolver is never even asked about it.
   */
  it.each([
    {
      label: 'publish-time shape',
      row: {
        pricingDecision: { resolvedLayer: 'SELLER_RETAIL_PRICE' },
        pricingResolverVersion: 'SELLER_RETAIL_PRICE_V1',
      },
    },
    {
      /**
       * The shape `updateSellerRetailPrices` writes on a draft save — no
       * `resolvedLayer` at all. A check that recognised only the publish-time
       * shape would have repriced every price entered this way, which is most
       * of them.
       */
      label: 'draft-save shape',
      row: {
        pricingDecision: { source: 'SELLER_RETAIL_PRICE', amountMinor: 330 },
        pricingResolverVersion: 'SELLER_RETAIL_PRICE_V1',
      },
    },
    {
      label: 'resolver version alone',
      row: {
        pricingDecision: null,
        pricingResolverVersion: 'SELLER_RETAIL_PRICE_V1',
      },
    },
  ])('never reprices a price a person typed ($label)', async ({ row }) => {
    const { executor } = recordingExecutor([candidate(row)]);

    const plan = await planReprice(executor as never, SELLER_ID, SCOPE);

    expect(plan.counts).toMatchObject({ manual: 1, changed: 0 });
    expect(resolveProductPricingMock).not.toHaveBeenCalled();
  });

  /**
   * The repair path, off by default.
   *
   * An earlier editor sent every price back as the seller's own on every save,
   * so offers nobody ever decided are stamped as decisions — 335 of them on the
   * first account to hit it. Reclaiming is the only way back, and it is
   * destructive enough that the default must stay "leave them alone".
   */
  describe('reclaiming prices a person typed', () => {
    const SELLER_ROW = {
      pricingDecision: { source: 'SELLER_RETAIL_PRICE', amountMinor: 330 },
      pricingResolverVersion: 'SELLER_RETAIL_PRICE_V1',
    };

    it('asks the resolver about them and marks them reclaimed', async () => {
      const { executor } = recordingExecutor([candidate(SELLER_ROW)]);

      const plan = await planReprice(executor as never, SELLER_ID, SCOPE, {
        reclaimSellerPriced: true,
      });

      expect(plan.counts).toMatchObject({ manual: 0, changed: 1 });
      expect(plan.lines[0]).toMatchObject({
        status: 'CHANGED',
        reclaimed: true,
      });
    });

    /**
     * The subtlety that would have made the repair silently partial.
     *
     * `writeReprice` only writes CHANGED lines, and an offer already sitting at
     * its rule's number would otherwise be UNCHANGED — leaving it stamped
     * `SELLER_RETAIL_PRICE_V1` and exempt from every future rule change, which
     * is the exact state this run exists to end. What moves is ownership, not
     * always the figure.
     */
    it('still writes one already sitting at the rule price', async () => {
      const { executor } = recordingExecutor([
        candidate({ ...SELLER_ROW, currentPriceMinor: BigInt(4400) }),
      ]);

      const plan = await planReprice(executor as never, SELLER_ID, SCOPE, {
        reclaimSellerPriced: true,
      });

      expect(plan.counts).toMatchObject({ unchanged: 0, changed: 1 });
      expect(plan.lines[0]).toMatchObject({ reclaimed: true });
    });

    it('leaves them alone by default', async () => {
      const { executor } = recordingExecutor([candidate(SELLER_ROW)]);

      const plan = await planReprice(executor as never, SELLER_ID, SCOPE);

      expect(plan.counts).toMatchObject({ manual: 1, changed: 0 });
      expect(resolveProductPricingMock).not.toHaveBeenCalled();
    });

    it('does not mark an ordinary reprice as reclaimed', async () => {
      // The audit distinguishes "a rule moved a price the rules owned" from
      // "a person's decision was taken back". They must not blur.
      const { executor } = recordingExecutor([candidate()]);

      const plan = await planReprice(executor as never, SELLER_ID, SCOPE, {
        reclaimSellerPriced: true,
      });

      expect(plan.lines[0]).toMatchObject({ reclaimed: false });
    });
  });

  it('keeps the live price and names the reason when the resolver refuses', async () => {
    const { executor } = recordingExecutor([candidate()]);
    resolveProductPricingMock.mockResolvedValue({
      outcome: 'PRICING_UNAVAILABLE',
      reason: 'SUPPLIER_COST_UNAVAILABLE',
      reasonLabel: 'Supplier cost unavailable',
      resolverVersion: 'pricing-resolver-v3',
    });

    const plan = await planReprice(executor as never, SELLER_ID, SCOPE);

    expect(plan.counts).toMatchObject({ unpriceable: 1, changed: 0 });
    expect(plan.lines[0]).toMatchObject({
      status: 'UNPRICEABLE',
      reasonLabel: 'Supplier cost unavailable',
      newPriceMinor: null,
    });
  });

  /**
   * An offer written for Fiji must be repriced by Fiji's rule. Passing the
   * screen's destination instead would move it onto another country's margin
   * without anything on screen saying so.
   */
  it('prices each offer against its own destination', async () => {
    const { executor } = recordingExecutor([
      candidate({ offerId: 'offer-fj', marketCode: 'FJ' }),
    ]);
    resolveProductPricingMock.mockResolvedValue(resolved(2999));

    await planReprice(executor as never, SELLER_ID, SCOPE);

    expect(resolveProductPricingMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ marketCode: 'FJ', categoryCode: 'CAT-GGL-1' }),
    );
  });

  it('passes a missing supplier cost through as null rather than inventing one', async () => {
    const { executor } = recordingExecutor([
      candidate({ costMinor: null, costCurrency: null }),
    ]);
    resolveProductPricingMock.mockResolvedValue({
      outcome: 'PRICING_UNAVAILABLE',
      reason: 'SUPPLIER_COST_UNAVAILABLE',
      reasonLabel: 'Supplier cost unavailable',
      resolverVersion: 'pricing-resolver-v3',
    });

    await planReprice(executor as never, SELLER_ID, SCOPE);

    expect(resolveProductPricingMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ supplierCost: null }),
    );
  });

  it('says so out loud when there are more offers than one run covers', async () => {
    const rows = Array.from({ length: MAX_REPRICE_OFFERS + 1 }, (_, index) =>
      candidate({ offerId: `offer-${index}` }),
    );
    const { executor } = recordingExecutor(rows);
    resolveProductPricingMock.mockResolvedValue(resolved(2399));

    const plan = await planReprice(executor as never, SELLER_ID, SCOPE);

    expect(plan.truncated).toBe(true);
    expect(plan.lines).toHaveLength(MAX_REPRICE_OFFERS);
  });

  describe('the fingerprint', () => {
    it('is stable for the same set of writes', async () => {
      resolveProductPricingMock.mockResolvedValue(resolved(2999));

      const first = await planReprice(
        recordingExecutor([candidate()]).executor as never,
        SELLER_ID,
        SCOPE,
      );
      const second = await planReprice(
        recordingExecutor([candidate()]).executor as never,
        SELLER_ID,
        SCOPE,
      );

      expect(first.fingerprint).toBe(second.fingerprint);
    });

    it('moves when a price would be written differently', async () => {
      resolveProductPricingMock.mockResolvedValue(resolved(2999));
      const first = await planReprice(
        recordingExecutor([candidate()]).executor as never,
        SELLER_ID,
        SCOPE,
      );

      resolveProductPricingMock.mockResolvedValue(resolved(3199));
      const second = await planReprice(
        recordingExecutor([candidate()]).executor as never,
        SELLER_ID,
        SCOPE,
      );

      expect(first.fingerprint).not.toBe(second.fingerprint);
    });
  });
});

describe('writeReprice', () => {
  function updatingExecutor(returns: unknown[][]) {
    const wheres: string[] = [];
    let callIndex = -1;

    const builder: Record<string, unknown> = {};
    builder.set = vi.fn(() => builder);
    builder.where = vi.fn((condition: SQL | undefined) => {
      wheres.push(
        condition === undefined ? '' : dialect.sqlToQuery(condition).sql,
      );
      return builder;
    });
    builder.returning = vi.fn(() => {
      callIndex += 1;
      return Promise.resolve(returns[callIndex] ?? []);
    });

    return { tx: { update: vi.fn(() => builder) }, wheres, builder };
  }

  function changedLine(overrides: Partial<RepriceLine> = {}): RepriceLine {
    return {
      offerId: 'offer-1',
      offerVersion: 3,
      productId: 'product-1',
      productTitle: 'Corduroy jacket',
      sku: 'SALS3-1',
      marketCode: 'AU',
      reclaimed: false,
      currentPriceMinor: 2399,
      currentPriceCurrency: 'USD',
      newPriceMinor: 2999,
      newPriceCurrency: 'USD',
      status: 'CHANGED',
      reason: null,
      reasonLabel: null,
      decision: resolved(2999) as never,
      ...overrides,
    };
  }

  it('writes only the changed lines', async () => {
    const { tx, builder } = updatingExecutor([[{ id: 'offer-1' }]]);

    const result = await writeReprice(
      tx as never,
      [
        changedLine(),
        changedLine({ offerId: 'offer-2', status: 'UNCHANGED' }),
        changedLine({ offerId: 'offer-3', status: 'UNPRICEABLE' }),
        changedLine({ offerId: 'offer-4', status: 'MANUAL' }),
      ],
      { actorId: 'user-1', sellerAccountId: SELLER_ID },
    );

    expect(result).toEqual({ ok: true, written: 1 });
    expect(builder.set).toHaveBeenCalledTimes(1);
  });

  /** Tenant scope and compare-and-set in the same predicate, as everywhere else in this codebase. */
  it('scopes every write to the seller and the version it planned from', async () => {
    const { tx, wheres } = updatingExecutor([[{ id: 'offer-1' }]]);

    await writeReprice(tx as never, [changedLine()], {
      actorId: 'user-1',
      sellerAccountId: SELLER_ID,
    });

    expect(wheres[0]).toContain('"seller_account_id" = ');
    expect(wheres[0]).toContain('"version" = ');
  });

  /**
   * A republish landing mid-run must abort the whole thing. A half-applied
   * reprice leaves the catalogue priced by two different decisions with
   * nothing on screen saying which rows took.
   */
  it('stops at the first offer that moved underneath it', async () => {
    const { tx, builder } = updatingExecutor([[{ id: 'offer-1' }], []]);

    const result = await writeReprice(
      tx as never,
      [
        changedLine(),
        changedLine({ offerId: 'offer-2' }),
        changedLine({ offerId: 'offer-3' }),
      ],
      { actorId: 'user-1', sellerAccountId: SELLER_ID },
    );

    expect(result).toEqual({ ok: false, reason: 'version_conflict' });
    // The third was never attempted.
    expect(builder.set).toHaveBeenCalledTimes(2);
  });
});
