// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  auditEvents,
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

const restoreModule = await import('./restore-option-mapping');
const restoreOptionMapping = restoreModule.default;
const { planFromSnapshot } = restoreModule;

const PRODUCT_ID = 'a1a1a1a1-1111-4111-8111-111111111111';
const SELLER_ID = 'b2b2b2b2-2222-4222-8222-222222222222';
const ACTOR_ID = 'actor-1';
const V1 = '11111111-1111-4111-8111-111111111111';
const V2 = '22222222-2222-4222-8222-222222222222';

/**
 * A 2 x 2 mapping as `toMappingSnapshot` writes it — one entry per variant ×
 * option, so a value used by two variants appears twice.
 *
 * `valuePosition` deliberately disagrees with the array order: `XL` is recorded at
 * position 0 and `L` at 1. A restore that reinstates array order instead of the
 * seller's arrangement would put them back the wrong way round, and nothing else
 * in the system could recover the intended order.
 */
const SNAPSHOT = [
  {
    optionName: 'Colour',
    optionPosition: 0,
    valueLabel: 'Black',
    valueNormalized: 'black',
    valuePosition: 0,
    variantId: V1,
  },
  {
    optionName: 'Size',
    optionPosition: 1,
    valueLabel: 'L',
    valueNormalized: 'l',
    valuePosition: 1,
    variantId: V1,
  },
  {
    optionName: 'Colour',
    optionPosition: 0,
    valueLabel: 'Black',
    valueNormalized: 'black',
    valuePosition: 0,
    variantId: V2,
  },
  {
    optionName: 'Size',
    optionPosition: 1,
    valueLabel: 'XL',
    valueNormalized: 'xl',
    valuePosition: 0,
    variantId: V2,
  },
];

describe('planFromSnapshot', () => {
  it('rebuilds axes in the seller’s recorded order, not the row order', () => {
    const plan = planFromSnapshot(PRODUCT_ID, SNAPSHOT);

    expect(plan?.axes.map((axis) => axis.name)).toEqual(['Colour', 'Size']);
    // `XL` was recorded at valuePosition 0 and appears second in the array. The
    // arrangement is the one thing in a mapping no algorithm can recover, so it
    // has to come back exactly as it was.
    expect(plan?.axes[1]?.values.map((value) => value.label)).toEqual([
      'XL',
      'L',
    ]);
  });

  it('collapses a value that many variants share into one', () => {
    const plan = planFromSnapshot(PRODUCT_ID, SNAPSHOT);

    // `Black` is on both variants and appears twice in a flat snapshot.
    expect(plan?.axes[0]?.values).toHaveLength(1);
  });

  it('gives every variant its full combination', () => {
    const plan = planFromSnapshot(PRODUCT_ID, SNAPSHOT);

    expect(plan?.assignments).toEqual([
      { variantId: V1, normalizedValues: ['black', 'l'] },
      { variantId: V2, normalizedValues: ['black', 'xl'] },
    ]);
  });

  it('drops a variant the snapshot only half describes', () => {
    // One axis recorded, two axes in the mapping. Writing this would put the
    // variant on a partial combination, which can collide with another partial.
    const plan = planFromSnapshot(PRODUCT_ID, [
      ...SNAPSHOT,
      {
        optionName: 'Colour',
        optionPosition: 0,
        valueLabel: 'Gray',
        valueNormalized: 'gray',
        valuePosition: 1,
        variantId: '33333333-3333-4333-8333-333333333333',
      },
    ]);

    expect(plan?.assignments.map((row) => row.variantId)).toEqual([V1, V2]);
  });

  it('refuses an axis whose values were all lost', () => {
    // The left joins in the snapshot query mean an axis with no values still
    // appears, carrying nulls. That is not a mapping anybody can be given back.
    expect(
      planFromSnapshot(PRODUCT_ID, [
        {
          optionName: 'Colour',
          optionPosition: 0,
          valueLabel: null,
          valueNormalized: null,
          valuePosition: null,
          variantId: null,
        },
      ]),
    ).toBe(undefined);
  });
});

type Overrides = {
  product?: Record<string, unknown> | null;
  existingMapping?: unknown[];
  event?: Record<string, unknown> | null;
  variants?: { id: string }[];
};

/**
 * Dispatches each read on the table it targets. Every read here hits a distinct
 * table — `products`, `product_options`, `audit_events`, `product_variants` — so
 * this needs no call counter and cannot break when a read moves.
 */
function transactionalDb(overrides: Overrides = {}) {
  const writes: { table: unknown; values?: Record<string, unknown> }[] = [];
  const idCounters = { option: 0, value: 0 };

  const rowsForTable = (table: unknown): unknown[] => {
    if (table === products) {
      if (overrides.product === null) return [];

      return [overrides.product ?? { id: PRODUCT_ID, version: 1 }];
    }

    if (table === productOptions) return overrides.existingMapping ?? [];
    if (table === auditEvents) {
      if (overrides.event === null) return [];

      return [
        overrides.event ?? {
          id: 'event-1',
          action: 'catalog_product.options_unmapped',
          payload: { removed: SNAPSHOT },
        },
      ];
    }
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
    insert: vi.fn((table: unknown) => {
      const chain: Record<string, unknown> = {};

      chain.values = vi.fn((values: Record<string, unknown>) => {
        writes.push({ table, values });

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
        writes.push({ table, values });

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

  return { db, writes };
}

function restore(db: unknown, expectedProductVersion = 1) {
  return restoreOptionMapping({
    productId: PRODUCT_ID,
    sellerAccountId: SELLER_ID,
    actorId: ACTOR_ID,
    expectedProductVersion,
    db: db as never,
  });
}

describe('restoreOptionMapping', () => {
  beforeEach(() => {
    mocks.appendAuditEvent.mockReset();
  });

  it('rebuilds the mapping and names the event it came from', async () => {
    const { db, writes } = transactionalDb();

    expect(await restore(db)).toEqual({
      ok: true,
      axisCount: 2,
      mappedVariantCount: 2,
      restoredFromEventId: 'event-1',
      restoredFromAction: 'catalog_product.options_unmapped',
    });

    const options = writes.filter((write) => write.table === productOptions);

    expect(options.map((write) => write.values?.name)).toEqual([
      'Colour',
      'Size',
    ]);

    const pairs = writes.filter(
      (write) => write.table === productVariantOptionValues,
    );

    expect(pairs).toHaveLength(4);
  });

  it('adds an event rather than touching the one it read', async () => {
    const { db } = transactionalDb();

    await restore(db);

    // `audit_events` is append-only, and a restore is a new state of the mapping
    // rather than an erasure of the removal that preceded it.
    expect(mocks.appendAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'catalog_product.options_restored',
        payload: expect.objectContaining({
          restoredFromEventId: 'event-1',
          axisNames: ['Colour', 'Size'],
        }),
      }),
    );
  });

  it('restores from a replacement as readily as from a removal', async () => {
    const { db } = transactionalDb({
      event: {
        id: 'event-9',
        action: 'catalog_product.options_remapped',
        payload: { replaced: SNAPSHOT },
      },
    });

    expect(await restore(db)).toMatchObject({
      ok: true,
      restoredFromAction: 'catalog_product.options_remapped',
    });
  });

  it('refuses a product that already has a mapping instead of overwriting it', async () => {
    const { db, writes } = transactionalDb({
      existingMapping: [{ optionId: 'option-existing', optionName: 'Colour' }],
    });

    expect(await restore(db)).toEqual({ ok: false, reason: 'ALREADY_MAPPED' });
    expect(writes).toHaveLength(0);
  });

  it('refuses when nothing was ever removed', async () => {
    const { db } = transactionalDb({ event: null });

    expect(await restore(db)).toEqual({
      ok: false,
      reason: 'NOTHING_TO_RESTORE',
    });
  });

  /**
   * `payload` is `jsonb` with no shape enforced by the database, and this module
   * turns it into what buyers read. A hand-edited row must land as a refusal, not
   * as a half-built mapping.
   */
  it('refuses a payload that does not parse', async () => {
    const { db, writes } = transactionalDb({
      event: {
        id: 'event-2',
        action: 'catalog_product.options_unmapped',
        payload: { removed: [{ optionName: '', optionPosition: -1 }] },
      },
    });

    expect(await restore(db)).toMatchObject({
      ok: false,
      reason: 'SNAPSHOT_UNREADABLE',
    });
    expect(writes).toHaveLength(0);
  });

  it('refuses an event carrying no snapshot at all', async () => {
    const { db } = transactionalDb({
      event: {
        id: 'event-3',
        action: 'catalog_product.options_unmapped',
        payload: { removedAxisCount: 2 },
      },
    });

    expect(await restore(db)).toMatchObject({
      ok: false,
      reason: 'SNAPSHOT_UNREADABLE',
    });
  });

  it('refuses when a variant in the snapshot is gone', async () => {
    const { db, writes } = transactionalDb({ variants: [{ id: V1 }] });

    expect(await restore(db)).toMatchObject({
      ok: false,
      reason: 'VARIANTS_CHANGED',
      detail: expect.stringContaining('1 gone'),
    });
    expect(writes).toHaveLength(0);
  });

  it('refuses when the product gained a variant the snapshot never covered', async () => {
    const { db } = transactionalDb({
      variants: [
        { id: V1 },
        { id: V2 },
        { id: '44444444-4444-4444-8444-444444444444' },
      ],
    });

    // Restoring would leave that variant unmapped inside a grid the others share,
    // which makes a buyer's selection unanswerable.
    expect(await restore(db)).toMatchObject({
      ok: false,
      reason: 'VARIANTS_CHANGED',
      detail: expect.stringContaining('1 new'),
    });
  });

  it('answers not_found for another seller’s product', async () => {
    const { db } = transactionalDb({ product: null });

    expect(await restore(db)).toEqual({ ok: false, reason: 'not_found' });
  });

  it('refuses a stale version', async () => {
    const { db } = transactionalDb();

    expect(await restore(db, 7)).toEqual({
      ok: false,
      reason: 'version_conflict',
    });
  });

  it('bumps the product version', async () => {
    const { db, writes } = transactionalDb();

    await restore(db);

    const [productWrite] = writes.filter(
      (write) =>
        write.table === products && write.values?.version !== undefined,
    );

    expect(productWrite?.values).toMatchObject({ version: 2 });
  });
});
