import { describe, expect, it, vi } from 'vitest';
import { and, eq, ne, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';

import { supplierCandidates } from '@/lib/db/schema/catalog';
import {
  productOffers,
  productRevisions,
  products,
} from '@/lib/db/schema/product-catalog';
import { supplierConnections } from '@/lib/db/schema/supplier-connections';

import {
  findCandidateSourceForSeller,
  findProductForSteward,
  findRevisionOfProduct,
  insertDraftRevision,
  markApprovedRevisionsSuperseded,
  saveDraftRevisionContent,
  updateSellerRetailPrices,
} from './repository';

/**
 * Ownership and compare-and-set live in the `WHERE` clause or they do not
 * exist. The tests below render the real SQL Drizzle would send, the same way
 * `candidates/repository.tenant-scope.test.ts` does — comparing
 * `String(sqlObject)` would render `"[object Object]"` and pass vacuously.
 *
 * What each assertion protects is a specific defect: a fetch-then-compare
 * ownership check (classic IDOR, plus an existence leak through the error
 * path), and a version-free update that lets a stale editor silently clobber
 * a change it never saw.
 */

const dialect = new PgDialect();

function renderSql(sql: SQL | undefined): { sql: string; params: unknown[] } {
  if (sql === undefined) {
    throw new Error('Expected a defined SQL condition, got undefined.');
  }

  return dialect.sqlToQuery(sql);
}

function selectExecutor(rows: unknown[]) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };

  return builder;
}

function updateExecutor(rows: unknown[]) {
  const builder = {
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(rows),
  };

  return builder;
}

/**
 * Three `where` calls per priced variant, in order: the variant-ownership
 * check, the read of the price as it stands, then the update itself. The middle
 * one exists because `UPDATE ... RETURNING` reports the row *after* the write,
 * so the previous price the audit records has to be read first.
 */
function priceUpdateExecutor(
  variantRows: unknown[],
  offerRows: unknown[],
  beforeRows: unknown[] = [],
) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi
      .fn()
      .mockReturnValueOnce(Promise.resolve(variantRows))
      .mockReturnValueOnce(Promise.resolve(beforeRows))
      .mockReturnThis(),
    returning: vi.fn().mockResolvedValue(offerRows),
  };

  return builder;
}

describe('findCandidateSourceForSeller', () => {
  it('scopes on the owning connection, not the candidate display column', () => {
    const executor = selectExecutor([]);

    return findCandidateSourceForSeller(
      executor as never,
      'candidate-a',
      'seller-a',
    ).then(() => {
      const actual = renderSql(executor.where.mock.calls[0][0] as SQL);
      // ADR-006/008 make the connection the source of truth for tenancy.
      // `supplier_candidates.intended_seller_id` is a legacy display field and
      // must never be the ownership predicate.
      const expected = renderSql(
        and(
          eq(supplierCandidates.id, 'candidate-a'),
          eq(supplierConnections.sellerAccountId, 'seller-a'),
        ),
      );

      expect(actual.sql).toBe(expected.sql);
      expect(actual.params).toEqual(expected.params);
    });
  });

  it('returns null for another tenant, indistinguishably from not found', () => {
    const executor = selectExecutor([]);

    return expect(
      findCandidateSourceForSeller(
        executor as never,
        'candidate-a',
        'seller-b',
      ),
    ).resolves.toBeNull();
  });
});

describe('findProductForSteward', () => {
  it('ands the product id with the steward account in one statement', () => {
    const executor = selectExecutor([]);

    return findProductForSteward(
      executor as never,
      'product-a',
      'seller-a',
    ).then(() => {
      const actual = renderSql(executor.where.mock.calls[0][0] as SQL);
      const expected = renderSql(
        and(
          eq(products.id, 'product-a'),
          eq(products.stewardSellerAccountId, 'seller-a'),
        ),
      );

      expect(actual.sql).toBe(expected.sql);
      expect(actual.params).toEqual(expected.params);
    });
  });
});

describe('updateSellerRetailPrices', () => {
  it('scopes the price update to the seller account and variant in one statement', async () => {
    const executor = priceUpdateExecutor(
      [{ id: 'variant-a' }],
      [{ id: 'offer-a' }],
    );

    await updateSellerRetailPrices(executor as never, {
      productId: 'product-a',
      sellerAccountId: 'seller-a',
      prices: [{ variantId: 'variant-a', amountMinor: 1999, currency: 'USD' }],
      actorId: 'actor-a',
    });

    const actual = renderSql(executor.where.mock.calls[2][0] as SQL);
    const expected = renderSql(
      and(
        eq(productOffers.sellerAccountId, 'seller-a'),
        eq(productOffers.variantId, 'variant-a'),
      ),
    );

    expect(actual.sql).toBe(expected.sql);
    expect(actual.params).toEqual(expected.params);
    expect(executor.set.mock.calls[0][0]).toMatchObject({
      priceAmountMinor: BigInt(1999),
      priceCurrency: 'USD',
      pricingState: 'RESOLVED',
      pricingUnavailableReason: null,
    });
  });

  it('reports a submitted variant whose seller offer did not update', async () => {
    const executor = priceUpdateExecutor([{ id: 'variant-a' }], []);

    await expect(
      updateSellerRetailPrices(executor as never, {
        productId: 'product-a',
        sellerAccountId: 'seller-a',
        prices: [
          { variantId: 'variant-a', amountMinor: 1999, currency: 'USD' },
        ],
        actorId: 'actor-a',
      }),
    ).resolves.toEqual({
      updatedOfferCount: 0,
      missedVariantIds: ['variant-a'],
      // Nothing was written, so there is nothing to audit.
      changes: [],
    });
  });

  it('reports a submitted variant that is not part of the product', async () => {
    const executor = priceUpdateExecutor([], []);

    await expect(
      updateSellerRetailPrices(executor as never, {
        productId: 'product-a',
        sellerAccountId: 'seller-a',
        prices: [
          { variantId: 'variant-b', amountMinor: 1999, currency: 'USD' },
        ],
        actorId: 'actor-a',
      }),
    ).resolves.toEqual({
      updatedOfferCount: 0,
      missedVariantIds: ['variant-b'],
      // Nothing was written, so there is nothing to audit.
      changes: [],
    });
    expect(executor.update).not.toHaveBeenCalled();
  });
});

describe('saveDraftRevisionContent', () => {
  const request = {
    revisionId: 'revision-a',
    productId: 'product-a',
    expectedVersion: 3,
    contentDocument: { version: 1 as const, blocks: [] },
    contentChecksum: 'checksum',
    actorId: 'actor-a',
  };

  it('gates the update on revision, product, DRAFT state, and expected version', async () => {
    const executor = updateExecutor([{ id: 'revision-a', version: 4 }]);

    await saveDraftRevisionContent(executor as never, request);

    const actual = renderSql(executor.where.mock.calls[0][0] as SQL);
    const expected = renderSql(
      and(
        eq(productRevisions.id, 'revision-a'),
        eq(productRevisions.productId, 'product-a'),
        // Dropping this term would let an APPROVED or SUPERSEDED revision be
        // rewritten in place - the exact mutation spec §16 and ADR-007
        // invariant 3 forbid.
        eq(productRevisions.workflowState, 'DRAFT'),
        // Dropping this term would let a stale editor overwrite a change it
        // never rendered.
        eq(productRevisions.version, 3),
      ),
    );

    expect(actual.sql).toBe(expected.sql);
    expect(actual.params).toEqual(expected.params);
  });

  it('advances the version by exactly one on a successful save', async () => {
    const executor = updateExecutor([{ id: 'revision-a', version: 4 }]);

    await saveDraftRevisionContent(executor as never, request);

    expect(executor.set.mock.calls[0][0]).toMatchObject({ version: 4 });
  });

  it('returns null when the compare-and-set matched nothing', async () => {
    const executor = updateExecutor([]);

    await expect(
      saveDraftRevisionContent(executor as never, request),
    ).resolves.toBeNull();
  });
});

describe('findRevisionOfProduct', () => {
  it('ands the revision id with its product rather than trusting the id', () => {
    const executor = selectExecutor([]);

    return findRevisionOfProduct(executor as never, {
      revisionId: 'revision-a',
      productId: 'product-a',
    }).then(() => {
      const actual = renderSql(executor.where.mock.calls[0][0] as SQL);
      // The fork path reads this before deciding whether to open a draft. The
      // caller has proven stewardship of *its* product; without this term a
      // revision id belonging to another seller's product would still be read
      // and forked from.
      const expected = renderSql(
        and(
          eq(productRevisions.id, 'revision-a'),
          eq(productRevisions.productId, 'product-a'),
        ),
      );

      expect(actual.sql).toBe(expected.sql);
      expect(actual.params).toEqual(expected.params);
    });
  });
});

describe('markApprovedRevisionsSuperseded', () => {
  it("retires the product's other approved revisions and nothing else", async () => {
    const executor = updateExecutor([{ id: 'revision-old' }]);

    await markApprovedRevisionsSuperseded(executor as never, {
      productId: 'product-a',
      exceptRevisionId: 'revision-new',
      actorId: 'actor-1',
      now: new Date('2026-08-25T00:00:00.000Z'),
    });

    const actual = renderSql(executor.where.mock.calls[0][0] as SQL);
    const expected = renderSql(
      and(
        eq(productRevisions.productId, 'product-a'),
        // Only APPROVED rows: a DRAFT must stay editable, and re-superseding a
        // SUPERSEDED row would move `updated_at` for nothing.
        eq(productRevisions.workflowState, 'APPROVED'),
        // Never the revision just published.
        ne(productRevisions.id, 'revision-new'),
      ),
    );

    expect(actual.sql).toBe(expected.sql);
    expect(actual.params).toEqual(expected.params);
  });

  it('leaves the frozen snapshot and freeze time untouched', async () => {
    const executor = updateExecutor([]);

    await markApprovedRevisionsSuperseded(executor as never, {
      productId: 'product-a',
      exceptRevisionId: 'revision-new',
      actorId: 'actor-1',
      now: new Date('2026-08-25T00:00:00.000Z'),
    });

    const values = executor.set.mock.calls[0][0] as Record<string, unknown>;

    // An accepted order references these bytes (ADR-007 invariant 3), and the
    // frozen-when-settled check constraint requires them to stay present.
    expect(values).not.toHaveProperty('contentSnapshot');
    expect(values).not.toHaveProperty('frozenAt');
    expect(values).toMatchObject({ workflowState: 'SUPERSEDED' });
  });
});

describe('insertDraftRevision', () => {
  /**
   * The only claim in this module that a mocked executor cannot make.
   *
   * `openDraftForEdit` treats a `null` return as "another writer holds this
   * product's open draft" and refuses cleanly. That is only true if the
   * statement really carries `on conflict do nothing`: a raised unique
   * violation would instead abort the surrounding transaction, so the loser
   * could not record why it lost and the caller's refusal path would never
   * run. Everywhere else in this suite renders the `WHERE` clause; here what
   * matters is the conflict clause, rendered from the same real dialect.
   */
  it('sends ON CONFLICT DO NOTHING rather than raising a unique violation', async () => {
    const db = drizzle.mock();
    let built: { getSQL: () => SQL } | undefined;

    // The real Drizzle builder, driven only by the calls the function itself
    // makes. If `insertDraftRevision` stopped calling `onConflictDoNothing`,
    // nothing would reach `built` and this fails on the assertion below rather
    // than passing against a query the test wrote for itself.
    const executor = {
      insert: (table: Parameters<typeof db.insert>[0]) => ({
        values: (input: never) => {
          const withValues = db.insert(table).values(input);

          return {
            onConflictDoNothing: () => {
              const withConflict = withValues.onConflictDoNothing();

              return {
                returning: async () => {
                  built = withConflict.returning();

                  return [];
                },
              };
            },
          };
        },
      }),
    };

    await insertDraftRevision(executor as never, {
      productId: 'product-a',
      revisionNumber: 3,
      expectedProductVersion: 7,
      contentDocument: { version: 1, blocks: [] },
      contentChecksum: 'checksum',
      actorId: 'actor-1',
    });

    if (built === undefined) {
      throw new Error('insertDraftRevision never reached the returning clause');
    }

    const rendered = dialect.sqlToQuery(built.getSQL()).sql;

    expect(rendered).toContain('on conflict do nothing');
    expect(rendered).toContain('returning');
  });
});
