import { describe, expect, it, vi } from 'vitest';
import { and, eq, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import { supplierCandidates } from '@/lib/db/schema/catalog';
import { productRevisions, products } from '@/lib/db/schema/product-catalog';
import { supplierConnections } from '@/lib/db/schema/supplier-connections';

import {
  findCandidateSourceForSeller,
  findProductForSteward,
  saveDraftRevisionContent,
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
