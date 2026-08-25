// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { TAXONOMY_V1_CODE_PREFIX } from '@/lib/products/sals3-category-code';
import { listCategoryMarginOverview } from './repository';

/**
 * Which categories Market Rules offers a margin against — a `WHERE` clause,
 * asserted as one.
 *
 * The screen shipped listing every `CJ-<uuid>` supplier mirror beside the real
 * departments, wearing the supplier's own raw path. That is not cosmetic:
 * `publishProduct` refuses a mirrored category, so a margin set against one can
 * never price a live listing, and offering `Set` on that row invites a seller to
 * configure nothing and believe otherwise.
 *
 * Rendered rather than behavioural, for the same reason
 * `read-model.published-scope.test.ts` gives: a fake executor answers with
 * whatever rows it was handed, so only the emitted SQL can show that the
 * predicate is there at all. `String(sqlObject)` would render
 * `"[object Object]"` and pass vacuously.
 */

const dialect = new PgDialect();

function recordingExecutor() {
  const recorded: string[] = [];

  const builder: Record<string, unknown> = {};
  const self = (): unknown => builder;

  ['from', 'innerJoin', 'leftJoin', 'orderBy'].forEach((name) => {
    builder[name] = vi.fn(self);
  });
  builder.where = vi.fn((condition: SQL | undefined) => {
    recorded.push(
      condition === undefined ? '' : dialect.sqlToQuery(condition).sql,
    );

    return builder;
  });
  builder.then = (resolve: (value: unknown) => unknown) => resolve([]);

  return { executor: { select: vi.fn(self) } as never, recorded };
}

async function renderedWhere(): Promise<string> {
  const { executor, recorded } = recordingExecutor();

  await listCategoryMarginOverview(executor, 'seller-1', null);

  return recorded[0] ?? '';
}

describe('listCategoryMarginOverview scope', () => {
  it('offers a margin only against a real Sals3 taxonomy code', async () => {
    const sql = await renderedWhere();

    // An allow list on the v1 prefix, not a block list on `CJ-`: the rule the
    // screen wants is "a real Sals3 category", and a block list would silently
    // admit whatever the third code convention turns out to be.
    expect(sql).toContain('like');
    expect(sql).toMatch(/"code"/);
  });

  it('binds the v1 prefix, so a mirror cannot satisfy it', async () => {
    const { executor, recorded } = recordingExecutor();

    await listCategoryMarginOverview(executor, 'seller-1', null);

    const where = (
      vi.mocked((executor as unknown as { select: () => unknown }).select).mock
        .results[0]?.value as { where: { mock: { calls: unknown[][] } } }
    ).where.mock.calls[0]?.[0] as SQL;
    const query = dialect.sqlToQuery(where);

    expect(recorded[0]).not.toBe('');
    // The bound parameter, not the literal: a hard-coded `'CAT-GGL-%'` inside
    // the SQL string would mean the prefix had drifted from the constant every
    // other caller tests against.
    expect(query.params).toContain(`${TAXONOMY_V1_CODE_PREFIX}%`);
  });

  it('keeps the depth test, so the list stays capped at L2', async () => {
    const sql = await renderedWhere();

    // `l3 IS NULL` is the depth test. Losing it would put all 5,595 rows on a
    // commercial-rules screen, which is the thing the L2 cap exists to prevent.
    expect(sql).toContain('"l3" is null');
  });

  it('keeps the depth escape hatch, and only that one', async () => {
    const sql = await renderedWhere();

    /**
     * One `OR … policy IS NOT NULL`, not two.
     *
     * The depth arm stays: a real `CAT-GGL-` category deeper than L2 that
     * already carries a policy must remain visible and editable, because a rate
     * actively pricing products must never become unreachable.
     *
     * The code arm is gone. It shipped as "never offered fresh, not never
     * shown" — a mirror carrying a policy stayed visible so it could be
     * deactivated — and in production **every** mirror carries one, because the
     * bulk 25% import wrote a policy to every row. The exception was written
     * for a rare case that turned out to be the normal one, so the screen
     * looked unchanged.
     *
     * Removing it strands nothing: a mirror's `path` is the supplier's raw
     * string separated by `/`, never an ancestor of a real taxonomy path, so
     * `findNearestActiveCategoryPolicy` can never select it. The row it leaves
     * behind is dead, not live.
     */
    const policyEscapes = sql.match(
      /"pricing_category_policies"\."id" is not null/g,
    );

    expect(policyEscapes).toHaveLength(1);
  });
});
