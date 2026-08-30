// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  productOptionValues,
  productOptions,
  productVariantOptionValues,
  productVariants,
  products,
} from '@/lib/db/schema';

const mocks = vi.hoisted(() => ({
  appendAuditEvent: vi.fn(),
}));

vi.mock('@/modules/catalog/candidates/repository', () => ({
  appendAuditEvent: mocks.appendAuditEvent,
}));

const remapOptionMapping = (await import('./remap-option-mapping')).default;

const PRODUCT_ID = 'a1a1a1a1-1111-4111-8111-111111111111';
const SELLER_ID = 'b2b2b2b2-2222-4222-8222-222222222222';
const ACTOR_ID = 'actor-1';
const V1 = '11111111-1111-4111-8111-111111111111';
const V2 = '22222222-2222-4222-8222-222222222222';

/** The mapping being replaced: one axis conflating colour and fit. */
const PREVIOUS = [
  {
    optionId: 'option-old',
    optionName: 'Colour & fit',
    optionPosition: 0,
    valueId: 'value-old-1',
    valueLabel: 'Black Men',
    valueNormalized: 'black men',
    valuePosition: 0,
    variantId: V1,
  },
  {
    optionId: 'option-old',
    optionName: 'Colour & fit',
    optionPosition: 0,
    valueId: 'value-old-2',
    valueLabel: 'Black Women',
    valueNormalized: 'black women',
    valuePosition: 1,
    variantId: V2,
  },
];

/** What it becomes: the two attributes pulled apart. */
const NEW_AXES = [
  { name: 'Colour', values: ['Black'] },
  { name: 'Fit', values: ['Men', 'Women'] },
];

const NEW_ASSIGNMENTS = [
  { variantId: V1, values: ['Black', 'Men'] },
  { variantId: V2, values: ['Black', 'Women'] },
];

type Overrides = {
  product?: Record<string, unknown> | null;
  previous?: unknown[];
  variants?: { id: string }[];
};

/** Records every write in order — the ordering is a correctness property here. */
function transactionalDb(overrides: Overrides = {}) {
  const writes: { op: string; table: unknown; values?: unknown }[] = [];
  const idCounters = { option: 0, value: 0 };

  const rowsForTable = (table: unknown): unknown[] => {
    if (table === products) {
      if (overrides.product === null) return [];

      return [overrides.product ?? { id: PRODUCT_ID, version: 1 }];
    }

    if (table === productOptions) return overrides.previous ?? PREVIOUS;
    if (table === productVariants) {
      return overrides.variants ?? [{ id: V1 }, { id: V2 }];
    }

    return [];
  };

  const selectChain = () => {
    let rows: unknown[] = [];
    const builder: Record<string, unknown> = {};

    builder.from = vi.fn((table: unknown) => {
      rows = rowsForTable(table);

      return builder;
    });
    ['leftJoin', 'where', 'orderBy'].forEach((name) => {
      builder[name] = vi.fn(() => builder);
    });
    builder.limit = vi.fn(() => rows);
    builder.then = (resolve: (value: unknown) => unknown) => resolve(rows);

    return builder;
  };

  const tx = {
    select: vi.fn(selectChain),
    delete: vi.fn((table: unknown) => {
      const chain: Record<string, unknown> = {};

      chain.where = vi.fn(() => {
        writes.push({ op: 'delete', table });

        return chain;
      });
      chain.then = (resolve: (value: unknown) => unknown) => resolve(undefined);

      return chain;
    }),
    insert: vi.fn((table: unknown) => {
      const chain: Record<string, unknown> = {};

      chain.values = vi.fn((values: Record<string, unknown>) => {
        writes.push({ op: 'insert', table, values });

        return chain;
      });
      chain.returning = vi.fn(() => {
        if (table === productOptions) {
          idCounters.option += 1;

          return Promise.resolve([{ id: `option-${idCounters.option}` }]);
        }

        if (table === productOptionValues) {
          idCounters.value += 1;

          return Promise.resolve([{ id: `value-${idCounters.value}` }]);
        }

        return Promise.resolve([{ id: 'row-1' }]);
      });
      chain.then = (resolve: (value: unknown) => unknown) => resolve(undefined);

      return chain;
    }),
    update: vi.fn((table: unknown) => {
      const chain: Record<string, unknown> = {};

      chain.set = vi.fn((values: Record<string, unknown>) => {
        writes.push({ op: 'update', table, values });

        return chain;
      });
      chain.where = vi.fn(() => chain);
      chain.then = (resolve: (value: unknown) => unknown) => resolve(undefined);

      return chain;
    }),
  };

  const db = {
    transaction: vi.fn(
      async (callback: (executor: unknown) => Promise<unknown>) => callback(tx),
    ),
  };

  return { db, writes, transaction: db.transaction };
}

function remap(
  db: unknown,
  axes = NEW_AXES,
  assignments = NEW_ASSIGNMENTS,
  expectedProductVersion = 1,
) {
  return remapOptionMapping({
    productId: PRODUCT_ID,
    sellerAccountId: SELLER_ID,
    actorId: ACTOR_ID,
    expectedProductVersion,
    axes,
    assignments,
    db: db as never,
  });
}

describe('remapOptionMapping', () => {
  beforeEach(() => {
    mocks.appendAuditEvent.mockReset();
  });

  it('replaces one axis with two, reporting both sides', async () => {
    const { db } = transactionalDb();

    expect(await remap(db)).toEqual({
      ok: true,
      axisCount: 2,
      mappedVariantCount: 2,
      replacedAxisCount: 1,
    });
  });

  /**
   * The property this module exists for. Unmap-then-map leaves a window in which
   * the live PDP has degraded and publishing is blocked; one transaction means a
   * buyer sees the old mapping or the new one and never raw labels.
   */
  it('does it all in one transaction', async () => {
    const { db, transaction } = transactionalDb();

    await remap(db);

    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('deletes before it writes, and the pairs before the options', async () => {
    const { db, writes } = transactionalDb();

    await remap(db);

    const tableName = (table: unknown): string => {
      if (table === productVariantOptionValues) return 'pairs';
      if (table === productOptions) return 'options';

      return 'values';
    };
    const order = writes
      .filter((write) => write.op !== 'update')
      .map((write) => `${write.op}:${tableName(write.table)}`);

    // RESTRICT edge first, then the options, and only then the new rows. Writing
    // first would compute combination keys against rows about to be removed.
    expect(order.slice(0, 3)).toEqual([
      'delete:pairs',
      'delete:options',
      'insert:options',
    ]);
  });

  it('snapshots the mapping it replaced, in the shape a restore can read', async () => {
    const { db } = transactionalDb();

    await remap(db, NEW_AXES, NEW_ASSIGNMENTS);

    const call = mocks.appendAuditEvent.mock.calls[0]?.[1] as {
      action: string;
      payload: {
        replaced: { valueLabel: string }[];
        axisNames: string[];
        replacedAxisCount: number;
      };
    };

    // Its own action: a replacement is neither a first mapping nor a removal.
    expect(call.action).toBe('catalog_product.options_remapped');
    expect(call.payload.axisNames).toEqual(['Colour', 'Fit']);
    expect(call.payload.replacedAxisCount).toBe(1);
    // `replaced` matches `options_unmapped`'s `removed`, so a restore reads either.
    expect(call.payload.replaced.map((row) => row.valueLabel)).toEqual([
      'Black Men',
      'Black Women',
    ]);
  });

  it('refuses a product with no mapping, which is a first mapping instead', async () => {
    const { db, writes } = transactionalDb({ previous: [] });

    expect(await remap(db)).toEqual({ ok: false, reason: 'NOT_MAPPED' });
    // Nothing written on the way to the refusal — in particular nothing deleted.
    expect(writes).toHaveLength(0);
  });

  it('applies the same collision refusal the first mapping does', async () => {
    const { db, writes } = transactionalDb();

    const result = await remap(db, NEW_AXES, [
      { variantId: V1, values: ['Black', 'Men'] },
      { variantId: V2, values: ['Black', 'Men'] },
    ]);

    expect(result).toMatchObject({
      ok: false,
      reason: 'COMBINATION_COLLISION',
    });
    // The old mapping survives a refused replacement. A delete before validation
    // would have destroyed it to write nothing.
    expect(writes).toHaveLength(0);
  });

  it('applies the same coverage refusal, without deleting first', async () => {
    const { db, writes } = transactionalDb();

    const result = await remap(db, NEW_AXES, [NEW_ASSIGNMENTS[0]!]);

    expect(result).toMatchObject({
      ok: false,
      reason: 'INCOMPLETE_ASSIGNMENT',
    });
    expect(writes).toHaveLength(0);
  });

  it('refuses a malformed payload before opening a transaction', async () => {
    const { db, transaction } = transactionalDb();

    const result = await remap(db, [], []);

    expect(result).toMatchObject({ ok: false, reason: 'NO_AXES' });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('answers not_found for another seller’s product', async () => {
    const { db } = transactionalDb({ product: null });

    expect(await remap(db)).toEqual({ ok: false, reason: 'not_found' });
  });

  it('refuses a stale version rather than replacing against a moved product', async () => {
    const { db, writes } = transactionalDb();

    expect(await remap(db, NEW_AXES, NEW_ASSIGNMENTS, 7)).toEqual({
      ok: false,
      reason: 'version_conflict',
    });
    expect(writes).toHaveLength(0);
  });

  it('bumps the product version once, not twice', async () => {
    const { db, writes } = transactionalDb();

    await remap(db);

    const productWrites = writes.filter(
      (write) =>
        write.table === products &&
        (write.values as { version?: number }).version !== undefined,
    );

    // One replacement is one edit. Unmap-then-map would have bumped it twice and
    // invalidated the seller's open editor in between.
    expect(productWrites).toHaveLength(1);
    expect(productWrites[0]?.values).toMatchObject({ version: 2 });
  });
});
