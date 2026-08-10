// @vitest-environment node
//
// `queries.ts` imports `@/lib/db/client`, which throws if `window` is
// defined (a real, load-bearing guard against ever bundling the DB client
// into client code) - the default jsdom test environment defines `window`,
// so this file needs the plain Node environment instead.
import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { classifyPipelineBucket } from './pipeline-bucket';
import { isExhaustedFailure, isPreExhaustionFailure } from './queries';

/**
 * `isPreExhaustionFailure`/`isExhaustedFailure` are the single shared
 * predicates `listEvaluatingCandidates`, `listDeadLetteredEvaluations`,
 * `oldestExceptionAgeMs`, and `countCandidateStatusSummary` all call - never
 * a fourth hand-rolled copy. `SQL.toString()` is not meaningful (Drizzle's
 * `SQL` class has no custom `toString`, so it always renders
 * `"[object Object]"` regardless of content - comparing that would be a
 * vacuous test). `PgDialect.sqlToQuery` is the real, pure-text renderer
 * Drizzle itself uses before sending a query to `postgres.js`; it needs no
 * live connection, so it is a meaningful way to assert the actual SQL text
 * without a database. Running the e2e `catalog-shortlist` suite against a
 * real Postgres remains the stronger end-to-end confirmation - see the
 * final report's verification notes.
 */
const dialect = new PgDialect();

/**
 * `and()`'s TS signature returns `SQL | undefined` because it also accepts
 * zero conditions - `isPreExhaustionFailure`/`isExhaustedFailure` always
 * pass two, so the result is never actually `undefined` at runtime. Assert
 * that explicitly rather than silencing it, so a real future regression
 * (e.g. someone reduces one of those functions to a single condition)
 * still fails loudly here instead of on `sqlToQuery`.
 */
function renderSql(sql: SQL | undefined): { sql: string; params: unknown[] } {
  if (sql === undefined) {
    throw new Error('Expected a defined SQL condition, got undefined.');
  }

  return dialect.sqlToQuery(sql);
}

describe('isPreExhaustionFailure / isExhaustedFailure', () => {
  it('agree with classifyPipelineBucket at the exact attemptCount boundary', () => {
    // classifyPipelineBucket is the pure oracle these two SQL builders are
    // hand-transcribed from - both sides must draw the line at the same
    // MAX_EVALUATION_ATTEMPTS value.
    expect(classifyPipelineBucket('EVALUATION_FAILED', 4)).toBe('evaluating');
    expect(classifyPipelineBucket('EVALUATION_FAILED', 5)).toBe(
      'exceptionQueue',
    );
  });

  it('both filter on status = EVALUATION_FAILED, parameterized (never string-concatenated)', () => {
    const pre = renderSql(isPreExhaustionFailure());
    const exhausted = renderSql(isExhaustedFailure());

    expect(pre.sql).toContain('"status" = $1');
    expect(pre.params[0]).toBe('EVALUATION_FAILED');
    expect(exhausted.sql).toContain('"status" = $1');
    expect(exhausted.params[0]).toBe('EVALUATION_FAILED');
  });

  it('use opposite, non-overlapping comparisons against the same attemptCount threshold', () => {
    const pre = renderSql(isPreExhaustionFailure());
    const exhausted = renderSql(isExhaustedFailure());

    // "<" vs ">=" against the same column and constant value: no
    // attemptCount can satisfy both, and every attemptCount satisfies
    // exactly one.
    expect(pre.sql).toContain('"attempt_count" < $2');
    expect(exhausted.sql).toContain('"attempt_count" >= $2');
    expect(pre.params[1]).toBe(exhausted.params[1]);
  });

  it('render as genuinely different SQL text', () => {
    expect(renderSql(isPreExhaustionFailure()).sql).not.toBe(
      renderSql(isExhaustedFailure()).sql,
    );
  });
});
