// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  fanOutUnscopedMargins,
  planFanOutUnscopedMargins,
} from './fan-out-unscoped-margins';

/**
 * What these cases can and cannot reach.
 *
 * This project has no in-memory Postgres, so the executor below is a fake and
 * these cases test the **orchestration**: how many copies are written, what
 * each one carries, what is skipped, and that the retire happens after the
 * copy. That is where this migration can silently do the wrong thing — write
 * five destinations instead of six, overwrite a deliberate rule, or retire a
 * row whose replacement never landed.
 *
 * What they cannot reach is the SQL predicate itself: that supplier mirrors are
 * excluded by `code LIKE 'CAT-GGL%'` and that only ACTIVE unscoped rows are
 * read. Those live in a Drizzle builder chain that a fake cannot evaluate, and
 * pretending otherwise is the trap this repo has been bitten by before — a
 * check that is not representative of the thing it checks. They are verified
 * against a real database by the break-glass GET before the POST is ever run.
 */

type SelectCall = { joined: boolean };

type Recorded = {
  selects: SelectCall[];
  inserted: Record<string, unknown>[];
  updatedIds: string[];
  audits: { action: string; payload: Record<string, unknown> }[];
  order: string[];
};

const DESTINATIONS = ['AU', 'PH', 'NZ', 'US', 'CA', 'FJ'];

function unscopedRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    policyId: 'policy-unscoped-1',
    sellerAccountId: 'seller-1',
    categoryId: 'category-1',
    categoryCode: 'CAT-GGL-166',
    targetMarginRate: '0.25',
    roundingRule: 'NONE',
    ...overrides,
  };
}

/**
 * A fake standing in for the Drizzle executor.
 *
 * `unscoped` answers the joined read (the all-destinations rules) and `scoped`
 * answers the un-joined read (rules that already have a destination), which is
 * the only thing that distinguishes the two queries from inside a fake.
 */
function fakeDb(unscoped: unknown[], scoped: unknown[]) {
  const recorded: Recorded = {
    selects: [],
    inserted: [],
    updatedIds: [],
    audits: [],
    order: [],
  };

  function selectBuilder() {
    const call: SelectCall = { joined: false };
    recorded.selects.push(call);

    const builder = {
      from: () => builder,
      innerJoin: () => {
        call.joined = true;
        return builder;
      },
      where: () => builder,
      then: (resolve: (rows: unknown[]) => unknown) =>
        Promise.resolve(call.joined ? unscoped : scoped).then(resolve),
    };

    return builder;
  }

  const executor = {
    select: selectBuilder,
    insert: (table: { _: { name?: string } } | unknown) => ({
      values: (values: Record<string, unknown> | Record<string, unknown>[]) => {
        const rows = Array.isArray(values) ? values : [values];
        const isAudit = rows.some((row) => 'entityType' in row);

        if (isAudit) {
          rows.forEach((row) => {
            recorded.order.push('audit');
            recorded.audits.push({
              action: row.action as string,
              payload: row.payload as Record<string, unknown>,
            });
          });

          return {
            then: (resolve: (value: unknown) => unknown) =>
              Promise.resolve(undefined).then(resolve),
            returning: () => ({
              then: (resolve: (rows: unknown[]) => unknown) =>
                Promise.resolve([]).then(resolve),
            }),
          };
        }

        rows.forEach((row) => {
          recorded.order.push('insert');
          recorded.inserted.push(row);
        });

        return {
          returning: () => ({
            then: (resolve: (out: unknown[]) => unknown) =>
              Promise.resolve(
                rows.map((_row, index) => ({
                  id: `created-${recorded.inserted.length - rows.length + index}`,
                })),
              ).then(resolve),
          }),
          then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve(undefined).then(resolve),
        };
      },
      _table: table,
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => {
            recorded.order.push('retire');
            const ids = (unscoped as { policyId: string }[]).map((row) => ({
              id: row.policyId,
            }));
            recorded.updatedIds.push(...ids.map((row) => row.id));

            return {
              then: (resolve: (rows: unknown[]) => unknown) =>
                Promise.resolve(ids).then(resolve),
            };
          },
        }),
      }),
    }),
  };

  const db = {
    ...executor,
    transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(executor),
  };

  return { db, recorded };
}

describe('planning the fan-out', () => {
  it('multiplies every unscoped rule by the open destinations', async () => {
    const { db } = fakeDb([unscopedRow()], []);

    const plan = await planFanOutUnscopedMargins(
      db as unknown as Parameters<typeof planFanOutUnscopedMargins>[0],
    );

    expect(plan.destinations).toEqual(DESTINATIONS);
    expect(plan.unscopedActive).toBe(1);
    expect(plan.wouldCreate).toBe(6);
    expect(plan.alreadyScoped).toBe(0);
  });

  it('writes nothing when there is nothing left to move', async () => {
    const { db, recorded } = fakeDb([], []);

    const result = await fanOutUnscopedMargins(
      db as unknown as Parameters<typeof fanOutUnscopedMargins>[0],
    );

    // Idempotency is the property that makes this route safe to re-run after a
    // timeout, when nobody can tell whether the first call committed.
    expect(result.created).toBe(0);
    expect(result.retired).toBe(0);
    expect(recorded.inserted).toHaveLength(0);
    expect(recorded.updatedIds).toHaveLength(0);
  });
});

describe('running the fan-out', () => {
  it('gives every destination the rate it already resolves to', async () => {
    const { db, recorded } = fakeDb([unscopedRow()], []);

    const result = await fanOutUnscopedMargins(
      db as unknown as Parameters<typeof fanOutUnscopedMargins>[0],
    );

    expect(result.created).toBe(6);
    expect(recorded.inserted.map((row) => row.marketCode).sort()).toEqual(
      [...DESTINATIONS].sort(),
    );

    // The whole claim of this migration is that no price moves. That holds
    // only if every copy carries the source rate and rounding unchanged.
    recorded.inserted.forEach((row) => {
      expect(row.targetMarginRate).toBe('0.25');
      expect(row.roundingRule).toBe('NONE');
      expect(row.status).toBe('ACTIVE');
      expect(row.supersedesId).toBe('policy-unscoped-1');
    });
  });

  it('never overwrites a destination that was set deliberately', async () => {
    const { db, recorded } = fakeDb(
      [unscopedRow()],
      [
        {
          sellerAccountId: 'seller-1',
          categoryId: 'category-1',
          marketCode: 'AU',
        },
      ],
    );

    const result = await fanOutUnscopedMargins(
      db as unknown as Parameters<typeof fanOutUnscopedMargins>[0],
    );

    // A rate someone chose for AU outranks a copied default, so AU is left
    // alone and only the other five are written.
    expect(result.created).toBe(5);
    expect(result.alreadyScoped).toBe(1);
    expect(recorded.inserted.map((row) => row.marketCode)).not.toContain('AU');
  });

  it('leaves another seller rule alone even on the same category', async () => {
    const { db, recorded } = fakeDb(
      [unscopedRow()],
      [
        {
          sellerAccountId: 'seller-2',
          categoryId: 'category-1',
          marketCode: 'AU',
        },
      ],
    );

    const result = await fanOutUnscopedMargins(
      db as unknown as Parameters<typeof fanOutUnscopedMargins>[0],
    );

    // The skip key is (seller, category, destination). Keyed on category alone
    // it would read a different tenant AU rule as this one and skip AU here,
    // leaving this seller with five destinations and no sixth.
    expect(result.created).toBe(6);
    expect(recorded.inserted.map((row) => row.marketCode)).toContain('AU');
  });

  it('copies before it retires', async () => {
    const { db, recorded } = fakeDb([unscopedRow()], []);

    await fanOutUnscopedMargins(
      db as unknown as Parameters<typeof fanOutUnscopedMargins>[0],
    );

    // Order is the safety argument, not a detail. Retiring first and failing
    // the copy would strip every category of the only rule pricing it.
    expect(recorded.order.indexOf('insert')).toBeLessThan(
      recorded.order.indexOf('retire'),
    );
    expect(recorded.updatedIds).toEqual(['policy-unscoped-1']);
  });

  it('records the move against each row it touches', async () => {
    const { db, recorded } = fakeDb([unscopedRow()], []);

    await fanOutUnscopedMargins(
      db as unknown as Parameters<typeof fanOutUnscopedMargins>[0],
    );

    const created = recorded.audits.filter(
      (event) => event.action === 'category_pricing_policy.created',
    );
    const superseded = recorded.audits.filter(
      (event) => event.action === 'category_pricing_policy.superseded',
    );

    // History on this screen is read from `audit_events` by category code, not
    // from the supersedes chain — so without these the six new rows would
    // appear with no explanation of where they came from.
    expect(created).toHaveLength(6);
    expect(superseded).toHaveLength(1);
    expect(created[0]?.payload.categoryCode).toBe('CAT-GGL-166');
    expect(created[0]?.payload.source).toBe('per-destination-migration');
  });
});
