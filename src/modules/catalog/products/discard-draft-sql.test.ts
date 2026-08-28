// @vitest-environment node
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { productRevisions } from '@/lib/db/schema';

/**
 * The discard's `SET` clause is a column-to-column copy, and nothing else in
 * this feature can see whether it renders correctly.
 *
 * `freezeDraftRevisionAsSuperseded` writes
 * `content_snapshot = content_document` through a raw `sql` template, because
 * the bytes that are retired must be the bytes the database actually held — a
 * caller-supplied document would let a discard record something that was never
 * in the draft. But the module test drives a mocked repository, so it proves the
 * *call*, never the statement: a `SET` clause that named the wrong column, or
 * stringified a column reference into a literal, would pass every other test in
 * this change while writing garbage into a JSONB column.
 *
 * This is the same lesson part 86 §1 recorded from the availability outage — a
 * test that stubs the executor tests the mapping and never the SQL — applied
 * before shipping rather than after.
 *
 * No connection is opened: `toSQL()` only builds the statement.
 */
describe('freezeDraftRevisionAsSuperseded SQL', () => {
  const db = drizzle({} as never);
  const NOW = new Date('2026-08-28T04:05:06.000Z');

  /** The exact statement the repository function builds. */
  function render() {
    return db
      .update(productRevisions)
      .set({
        workflowState: 'SUPERSEDED',
        contentSnapshot: sql`${productRevisions.contentDocument}`,
        frozenAt: NOW,
        version: 3,
        updatedAt: NOW,
        updatedBy: 'actor-1',
      })
      .where(
        and(
          eq(productRevisions.id, 'revision-1'),
          eq(productRevisions.productId, 'product-1'),
          eq(productRevisions.workflowState, 'DRAFT'),
          eq(productRevisions.version, 2),
        ),
      )
      .toSQL();
  }

  it('copies the column rather than binding a literal', () => {
    const { sql: text, params } = render();

    // The right-hand side must be the column itself. If drizzle had flattened
    // it to a parameter, this would read `"content_snapshot" = $n` and the
    // snapshot would be filled with whatever that parameter held.
    expect(text).toMatch(
      /"content_snapshot"\s*=\s*"product_revisions"\."content_document"/u,
    );

    // And no bound parameter may carry a document: the only params here are the
    // state, the timestamps, the version, the actor, and the WHERE values.
    expect(params).not.toContainEqual(
      expect.objectContaining({ blocks: expect.anything() }),
    );
  });

  it('freezes the row in the same statement that settles it', () => {
    const { sql: text } = render();

    // `product_revisions_frozen_when_settled` requires content_snapshot AND
    // frozen_at on a SUPERSEDED row. Setting the state without both in the same
    // UPDATE would violate the check constraint at commit.
    expect(text).toMatch(/"workflow_state"\s*=/u);
    expect(text).toMatch(/"frozen_at"\s*=/u);
    expect(text).toMatch(/"content_snapshot"\s*=/u);
  });

  it('carries all four compare-and-set conditions in the WHERE clause', () => {
    const { sql: text } = render();
    const where = text.slice(text.indexOf('where'));

    // Dropping any one of these reintroduces a real defect: the row, the
    // product that owns it, DRAFT (so a settled revision is never retired
    // here), and the version the editor rendered.
    expect(where).toMatch(/"id"\s*=/u);
    expect(where).toMatch(/"product_id"\s*=/u);
    expect(where).toMatch(/"workflow_state"\s*=/u);
    expect(where).toMatch(/"version"\s*=/u);
  });
});
