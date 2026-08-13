import { describe, expect, it, vi } from 'vitest';
import { inArray, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { providerProductReferences } from '@/lib/db/schema/product-catalog';
import { listCandidateIdsWithProducts } from './repository';

const dialect = new PgDialect();

function renderSql(sql: SQL): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(sql);
}

function selectExecutor(rows: unknown[]) {
  const builder = {
    selectDistinct: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(rows),
  };

  return builder;
}

describe('listCandidateIdsWithProducts', () => {
  /**
   * The pipeline calls this on every Ready/Needs-Attention render. An empty
   * page must cost zero statements, not one degenerate `IN ()` query.
   */
  it('short-circuits an empty input without touching the database', async () => {
    const executor = selectExecutor([]);

    await expect(
      listCandidateIdsWithProducts(executor as never, []),
    ).resolves.toEqual([]);
    expect(executor.selectDistinct).not.toHaveBeenCalled();
  });

  it('filters with inArray on the source candidate ids', async () => {
    const executor = selectExecutor([]);

    await listCandidateIdsWithProducts(executor as never, ['id-1', 'id-2']);

    const actual = renderSql(executor.where.mock.calls[0][0] as SQL);
    const expected = renderSql(
      inArray(providerProductReferences.sourceCandidateId, ['id-1', 'id-2']),
    );

    expect(actual.sql).toBe(expected.sql);
    expect(actual.params).toEqual(expected.params);
  });

  /** A null provenance link (candidate deleted) must never surface as a match. */
  it('drops rows whose provenance link was severed', async () => {
    const executor = selectExecutor([
      { sourceCandidateId: 'id-1', productId: 'product-1' },
      { sourceCandidateId: null, productId: 'product-2' },
    ]);

    await expect(
      listCandidateIdsWithProducts(executor as never, ['id-1']),
    ).resolves.toEqual([{ sourceCandidateId: 'id-1', productId: 'product-1' }]);
  });
});
