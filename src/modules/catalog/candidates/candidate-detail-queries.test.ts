// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { and, eq, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { supplierCandidates } from '@/lib/db/schema/catalog';
import { supplierConnections } from '@/lib/db/schema/supplier-connections';

/**
 * Tenancy lives in the `WHERE` clause or it does not exist. These tests render
 * the real SQL Drizzle would send, the same way
 * `products/repository.tenant-scope.test.ts` does - comparing
 * `String(sqlObject)` would render `"[object Object]"` and pass vacuously.
 *
 * The second test is the one that matters most: it proves that a candidate
 * belonging to another seller costs exactly ONE statement, so a guessed uuid
 * never reaches `audit_events` - a table with no tenant column of its own.
 */

const dialect = new PgDialect();

function renderSql(sql: SQL): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(sql);
}

/**
 * A builder that resolves to `gateRows` however it is chained, recording each
 * `WHERE` and counting each terminal statement. Drizzle builders are thenable,
 * so awaiting a chain with no `.limit()` still resolves.
 */
function recorder(gateRows: unknown[]) {
  const wheres: SQL[] = [];
  let statements = 0;

  function fakeDb() {
    const builder: Record<string, unknown> = {};
    const chain = () => builder;

    ['select', 'from', 'innerJoin', 'leftJoin', 'orderBy'].forEach((method) => {
      builder[method] = vi.fn(chain);
    });

    builder.where = vi.fn((condition: SQL) => {
      wheres.push(condition);

      return builder;
    });
    builder.limit = vi.fn(() => {
      statements += 1;

      return Promise.resolve(gateRows);
    });
    builder.then = (resolve: (value: unknown[]) => unknown) => {
      statements += 1;

      return Promise.resolve(gateRows).then(resolve);
    };

    return builder;
  }

  return {
    fakeDb,
    wheres,
    statementCount: () => statements,
  };
}

async function runResolve(gateRows: unknown[]) {
  const recorded = recorder(gateRows);

  vi.resetModules();
  vi.doMock('@/lib/db/client', () => ({ default: recorded.fakeDb }));

  const { default: resolveCandidateDetail } =
    await import('./candidate-detail-queries');
  const result = await resolveCandidateDetail('seller-a', 'candidate-a');

  return { result, recorded };
}

describe('resolveCandidateDetail', () => {
  it('scopes on the owning connection, not the legacy display column', async () => {
    const { recorded } = await runResolve([]);

    const actual = renderSql(recorded.wheres[0]);
    // ADR-008 makes the connection the source of truth for tenancy.
    // `supplier_candidates.intended_seller_id` must never be the predicate.
    const expected = renderSql(
      and(
        eq(supplierCandidates.id, 'candidate-a'),
        eq(supplierConnections.sellerAccountId, 'seller-a'),
      ) as SQL,
    );

    expect(actual.sql).toBe(expected.sql);
    expect(actual.params).toEqual(expected.params);
  });

  it('issues exactly one statement and returns null when the gate denies', async () => {
    const { result, recorded } = await runResolve([]);

    expect(result).toBeNull();
    // The whole point: no child table is touched for an unknown or
    // cross-tenant id, including `audit_events`, which has no tenant column.
    expect(recorded.statementCount()).toBe(1);
  });

  it('reads the six child tables once the gate allows', async () => {
    const { result, recorded } = await runResolve([
      {
        candidate: { id: 'candidate-a' },
        connectionId: 'connection-a',
        connectionStatus: 'ACTIVE',
        evaluation: null,
        snapshotSchemaVersion: null,
        snapshotChecksum: null,
        snapshotCapturedAt: null,
        snapshotEvidence: null,
      },
    ]);

    expect(recorded.statementCount()).toBe(7);
    expect(result?.connection).toEqual({
      id: 'connection-a',
      status: 'ACTIVE',
    });
    // Discovered but never queued: no evaluation, so no feed snapshot either.
    expect(result?.evaluation).toBeNull();
    expect(result?.feedSnapshot).toBeNull();
    // Never fetched, not "CJ reported nothing".
    expect(result?.snapshot).toBeNull();
  });

  it('degrades an unparseable feed snapshot to null instead of throwing', async () => {
    const { result } = await runResolve([
      {
        candidate: { id: 'candidate-a' },
        connectionId: 'connection-a',
        connectionStatus: 'ACTIVE',
        evaluation: { feedSnapshot: { nonsense: true }, evidenceSummary: null },
        snapshotSchemaVersion: null,
        snapshotChecksum: null,
        snapshotCapturedAt: null,
        snapshotEvidence: null,
      },
    ]);

    expect(result?.feedSnapshot).toBeNull();
    expect(result?.evaluation).not.toBeNull();
  });
});
