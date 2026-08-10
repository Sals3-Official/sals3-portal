import { describe, expect, it } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { candidateEvaluations } from '@/lib/db/schema';
import { EVALUATION_STATUSES } from './rules/contracts';

/**
 * "All Supplier Products must never return a persisted product with a
 * null/missing status." The guarantee is structural: the status column is
 * NOT NULL with a default, discovery inserts the evaluation row in the same
 * transaction as the candidate (see `discovery/ingest-product.ts`), and the
 * read model (`queries.ts#findEvaluationsByExternalIds`) inner-joins
 * `candidate_evaluations` - so a persisted candidate can never surface
 * without a status. These assertions pin the structural half so a future
 * schema edit cannot silently weaken it.
 */
describe('candidate status is structurally non-null', () => {
  it('the status column is NOT NULL with a QUEUED default', () => {
    const columns = getTableColumns(candidateEvaluations);

    expect(columns.status.notNull).toBe(true);
    expect(columns.status.hasDefault).toBe(true);
    expect(columns.status.default).toBe('QUEUED');
  });

  it('every persisted status is one of the approved lifecycle values', () => {
    const columns = getTableColumns(candidateEvaluations);

    expect(columns.status.enumValues).toEqual([...EVALUATION_STATUSES]);
  });
});
