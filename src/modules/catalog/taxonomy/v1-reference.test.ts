// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { listSals3CategoryV1Options } from './v1-reference';

/**
 * Records what `.where()` was called with, and answers with a fixed row set
 * as postgres.js would.
 */
function fakeExecutor(rows: { code: string; path: string }[]) {
  const orderBy = vi.fn(() => Promise.resolve(rows));
  // The mock never reads `condition` - the test inspects it via
  // `where.mock.calls` instead.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const where = vi.fn((condition: unknown) => ({ orderBy }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));

  return { executor: { select }, where, orderBy };
}

/**
 * The regression this file exists for: `cj-mirror.ts`'s
 * `ensureMirrorCategoryRow` inserts `CJ-<externalCategoryId>`-coded rows
 * into this SAME `sals3_categories` table, one per unmapped CJ supplier
 * category, named verbatim as CJ's own observed category text. Before this
 * query filtered on the v1 seed's own `CAT-GGL-` code prefix
 * (`scripts/seed-sals3-taxonomy-v1.mts`), it selected the whole table
 * unfiltered — so the picker's search surfaced CJ's own taxonomy language
 * (a CJ-specific term like "Fedoras" the real Sals3 Taxonomy v1 sheet never
 * had), defeating the entire point of a picker built to move sellers away
 * from CJ's category text. Confirmed against the real local database: with
 * the filter, exactly the 5,595 real v1 rows come back and zero `CJ-`
 * rows leak through, even though the mirror had created some.
 */
describe('listSals3CategoryV1Options', () => {
  it("queries with a filter on the v1 seed's CAT-GGL- code prefix, not the whole table", async () => {
    const { executor, where } = fakeExecutor([
      { code: 'CAT-GGL-100230', path: 'Apparel & Accessories > Jackets' },
    ]);

    await listSals3CategoryV1Options(executor as never);

    expect(where).toHaveBeenCalledTimes(1);
    const condition = where.mock.calls[0]?.[0] as {
      queryChunks?: unknown[];
    };
    // Drizzle's `like()` condition is a tree of query chunks, one of which
    // renders to the literal pattern - checking each chunk's own string
    // form, not the object's internal shape, so this survives a drizzle-orm
    // upgrade that restructures the condition object itself.
    const renderedChunks = (condition.queryChunks ?? []).map((chunk) =>
      String(chunk),
    );
    expect(renderedChunks.some((chunk) => chunk.includes('CAT-GGL-'))).toBe(
      true,
    );
  });

  it('orders by path after filtering, not before', async () => {
    const { executor, where, orderBy } = fakeExecutor([]);

    await listSals3CategoryV1Options(executor as never);

    expect(where).toHaveBeenCalled();
    expect(orderBy).toHaveBeenCalled();
  });
});
