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

  await listCategoryMarginOverview(executor, 'seller-1');

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

    await listCategoryMarginOverview(executor, 'seller-1');

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

  it('still shows any category that already carries a policy', async () => {
    const sql = await renderedWhere();

    /**
     * Both escape hatches are `OR`s against the policy id, and they are the
     * reason this is "never offered fresh" rather than "never shown": a mirror
     * that already carries a real, versioned policy must stay visible so it can
     * be deactivated. Hiding it would strand the row where nobody could reach
     * it.
     */
    const policyEscapes = sql.match(
      /"pricing_category_policies"\."id" is not null/g,
    );

    expect(policyEscapes).toHaveLength(2);
  });
});
