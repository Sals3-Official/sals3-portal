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

const saveManualOptionMapping = (await import('./save-manual-option-mapping'))
  .default;

const PRODUCT_ID = 'a1a1a1a1-1111-4111-8111-111111111111';
const SELLER_ID = 'b2b2b2b2-2222-4222-8222-222222222222';
const ACTOR_ID = 'actor-1';

type Overrides = {
  product?: Record<string, unknown> | null;
  existingOptions?: Record<string, unknown>[];
  variants?: { variantId: string; label: string | null }[];
};

/**
 * Same dispatching fake as `save-option-mapping.test.ts`, for the same reason:
 * the assertions are about what this module decided to write, not about Postgres.
 * The unique indexes it relies on are asserted in `product-catalog.test.ts`.
 */
function transactionalDb(overrides: Overrides = {}) {
  const writes: { table: unknown; values: Record<string, unknown> }[] = [];
  const idCounters = { option: 0, value: 0 };

  const rowsForTable = (table: unknown): unknown[] => {
    if (table === products) {
      if (overrides.product === null) return [];

      return [overrides.product ?? { id: PRODUCT_ID, version: 1 }];
    }

    if (table === productOptions) return overrides.existingOptions ?? [];
    if (table === productVariants) return overrides.variants ?? [];

    return [];
  };

  const selectChain = () => {
    let rows: unknown[] = [];
    const builder: Record<string, unknown> = {};

    builder.from = vi.fn((table: unknown) => {
      rows = rowsForTable(table);

      return builder;
    });
    ['leftJoin', 'where'].forEach((name) => {
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

  return { db, tx, writes };
}

function save(
  db: unknown,
  axes: { name: string; values: string[] }[],
  assignments: { variantId: string; values: string[] }[],
  expectedProductVersion = 1,
) {
  return saveManualOptionMapping({
    productId: PRODUCT_ID,
    sellerAccountId: SELLER_ID,
    actorId: ACTOR_ID,
    expectedProductVersion,
    axes,
    assignments,
    db: db as never,
  });
}

/**
 * The real tactical pants, trimmed to eight variants but keeping the shape that
 * defeats every derivation: one supplier token holds a colour *and* a gender, and
 * spells the gender four different ways with the word order reversed on one of
 * them. `Female, Gray` is the supplier's own string.
 *
 * No delimiter split produces a `Colour` axis here, however clean the arithmetic
 * — which is why this path takes the structure from a person.
 */
const PANTS_VARIANTS = [
  'Black Men-L',
  'Black Men-XL',
  'Gray Male-L',
  'Gray Male-XL',
  'Black Female-L',
  'Black Female-XL',
  'Female, Gray-L',
  'Female, Gray-XL',
].map((label, index) => ({ variantId: `variant-${index + 1}`, label }));

const PANTS_AXES = [
  { name: 'Colour', values: ['Black', 'Gray'] },
  { name: 'Fit', values: ['Men', 'Women'] },
  { name: 'Size', values: ['L', 'XL'] },
];

/** What a person reads off each label. Three axes out of two tokens. */
const PANTS_ASSIGNMENTS = [
  { variantId: 'variant-1', values: ['Black', 'Men', 'L'] },
  { variantId: 'variant-2', values: ['Black', 'Men', 'XL'] },
  { variantId: 'variant-3', values: ['Gray', 'Men', 'L'] },
  { variantId: 'variant-4', values: ['Gray', 'Men', 'XL'] },
  { variantId: 'variant-5', values: ['Black', 'Women', 'L'] },
  { variantId: 'variant-6', values: ['Black', 'Women', 'XL'] },
  { variantId: 'variant-7', values: ['Gray', 'Women', 'L'] },
  { variantId: 'variant-8', values: ['Gray', 'Women', 'XL'] },
];

describe('saveManualOptionMapping', () => {
  beforeEach(() => {
    mocks.appendAuditEvent.mockReset();
  });

  it('splits one supplier token into two axes, which no derivation can do', () => {
    // The property that justifies this whole path: `Black Men` is one token, and
    // it lands on two different axes.
    const colours = new Set(
      PANTS_ASSIGNMENTS.map((assignment) => assignment.values[0]),
    );
    const fits = new Set(
      PANTS_ASSIGNMENTS.map((assignment) => assignment.values[1]),
    );

    expect([...colours]).toEqual(['Black', 'Gray']);
    expect([...fits]).toEqual(['Men', 'Women']);
  });

  it('writes three axes and links every variant on all of them', async () => {
    const { db, writes } = transactionalDb({ variants: PANTS_VARIANTS });

    const result = await save(db, PANTS_AXES, PANTS_ASSIGNMENTS);

    expect(result).toEqual({
      ok: true,
      axisCount: 3,
      mappedVariantCount: 8,
    });

    const options = writes.filter((write) => write.table === productOptions);

    expect(options.map((write) => write.values.name)).toEqual([
      'Colour',
      'Fit',
      'Size',
    ]);
    // Position comes from the submitted axis order, which is the order a buyer
    // will read the rows in.
    expect(options.map((write) => write.values.position)).toEqual([0, 1, 2]);

    // One pair per axis per variant, and every variant reached.
    const pairs = writes.filter(
      (write) => write.table === productVariantOptionValues,
    );

    expect(pairs).toHaveLength(8 * 3);
    expect(new Set(pairs.map((write) => write.values.variantId)).size).toBe(8);

    // Every variant got a combination key, so every one of them can be `ACTIVE`.
    const keyed = writes.filter(
      (write) =>
        write.table === productVariants &&
        write.values.optionCombinationKey !== undefined,
    );

    expect(keyed).toHaveLength(8);
    expect(
      new Set(keyed.map((write) => write.values.optionCombinationKey)).size,
    ).toBe(8);
  });

  it('stores the buyer label trimmed and the join key normalized', async () => {
    const { db, writes } = transactionalDb({
      variants: [{ variantId: 'variant-1', label: 'Whatever' }],
    });

    await save(
      db,
      [{ name: '  Colour  ', values: ['  Light Brown  '] }],
      [{ variantId: 'variant-1', values: ['  Light Brown  '] }],
    );

    const [value] = writes.filter(
      (write) => write.table === productOptionValues,
    );

    expect(value?.values.label).toBe('Light Brown');
    // Normalized separately, so renaming the label later cannot repoint a
    // variant onto another variant's row.
    expect(value?.values.normalizedValue).not.toBe('  Light Brown  ');
  });

  it('refuses when a variant of the product was left out', async () => {
    const { db, writes } = transactionalDb({ variants: PANTS_VARIANTS });

    const result = await save(db, PANTS_AXES, PANTS_ASSIGNMENTS.slice(0, 6));

    expect(result).toMatchObject({
      ok: false,
      reason: 'INCOMPLETE_ASSIGNMENT',
      detail: expect.stringContaining("2 of this product's 8 variants"),
    });
    // Nothing was written on the way to the refusal.
    expect(writes).toHaveLength(0);
  });

  it('refuses a variant id the product does not have, rather than trusting the payload', async () => {
    const { db, writes } = transactionalDb({ variants: PANTS_VARIANTS });

    const result = await save(db, PANTS_AXES, [
      ...PANTS_ASSIGNMENTS.slice(0, 7),
      { variantId: 'someone-elses-variant', values: ['Gray', 'Women', 'XL'] },
    ]);

    expect(result).toMatchObject({ ok: false, reason: 'UNKNOWN_VARIANT' });
    expect(writes).toHaveLength(0);
  });

  it('refuses the same variant assigned twice', async () => {
    const { db } = transactionalDb({ variants: PANTS_VARIANTS });

    const result = await save(db, PANTS_AXES, [
      ...PANTS_ASSIGNMENTS.slice(0, 7),
      { variantId: 'variant-1', values: ['Gray', 'Women', 'XL'] },
    ]);

    expect(result).toMatchObject({
      ok: false,
      reason: 'UNKNOWN_VARIANT',
      detail: expect.stringContaining('more than once'),
    });
  });

  /**
   * The refusal a buyer is actually protected by. Two variants on one combination
   * means a selection can be honoured by either, so the buyer may be handed the
   * price of the one they did not pick.
   *
   * `product_variants_active_combination_key` refuses this at the database too,
   * but a raised unique violation aborts the transaction, so it is caught before
   * any row is written.
   */
  it('refuses two variants given the same combination', async () => {
    const { db, writes } = transactionalDb({ variants: PANTS_VARIANTS });

    const result = await save(db, PANTS_AXES, [
      ...PANTS_ASSIGNMENTS.slice(0, 7),
      // variant-8 handed variant-7's exact combination.
      { variantId: 'variant-8', values: ['Gray', 'Women', 'L'] },
    ]);

    expect(result).toMatchObject({
      ok: false,
      reason: 'COMBINATION_COLLISION',
    });
    expect(writes).toHaveLength(0);
  });

  it('refuses a value that is not in its own axis', async () => {
    const { db } = transactionalDb({ variants: PANTS_VARIANTS });

    const result = await save(db, PANTS_AXES, [
      // `Khaki` was never declared on the Colour axis.
      { variantId: 'variant-1', values: ['Khaki', 'Men', 'L'] },
      ...PANTS_ASSIGNMENTS.slice(1),
    ]);

    expect(result).toMatchObject({ ok: false, reason: 'UNKNOWN_VALUE' });
  });

  it('refuses an assignment that skips an axis', async () => {
    const { db } = transactionalDb({ variants: PANTS_VARIANTS });

    const result = await save(db, PANTS_AXES, [
      { variantId: 'variant-1', values: ['Black', 'Men'] },
      ...PANTS_ASSIGNMENTS.slice(1),
    ]);

    expect(result).toMatchObject({
      ok: false,
      reason: 'INCOMPLETE_ASSIGNMENT',
    });
  });

  it('refuses two axes whose names a unique index could not tell apart', async () => {
    const { db } = transactionalDb({ variants: PANTS_VARIANTS });

    const result = await save(
      db,
      [
        { name: 'Colour', values: ['Black'] },
        { name: 'colour', values: ['Men'] },
      ],
      [],
    );

    expect(result).toMatchObject({ ok: false, reason: 'VALUE_COLLISION' });
  });

  it('refuses two values in one axis that normalize alike', async () => {
    const { db } = transactionalDb({ variants: PANTS_VARIANTS });

    const result = await save(
      db,
      [{ name: 'Colour', values: ['Black', 'black'] }],
      [],
    );

    expect(result).toMatchObject({
      ok: false,
      reason: 'VALUE_COLLISION',
      detail: expect.stringContaining('Colour'),
    });
  });

  it('allows one value to appear under two different axes', async () => {
    // `product_option_values_option_normalized_key` is scoped to one option, so
    // Natural as a colour and Natural as a material are two different rows.
    const { db } = transactionalDb({
      variants: [{ variantId: 'variant-1', label: 'Natural-Natural' }],
    });

    const result = await save(
      db,
      [
        { name: 'Colour', values: ['Natural'] },
        { name: 'Material', values: ['Natural'] },
      ],
      [{ variantId: 'variant-1', values: ['Natural', 'Natural'] }],
    );

    expect(result).toMatchObject({ ok: true, mappedVariantCount: 1 });
  });

  it('refuses a product that already has options mapped', async () => {
    const { db } = transactionalDb({
      existingOptions: [{ id: 'option-existing' }],
      variants: PANTS_VARIANTS,
    });

    expect(await save(db, PANTS_AXES, PANTS_ASSIGNMENTS)).toMatchObject({
      ok: false,
      reason: 'ALREADY_MAPPED',
    });
  });

  it('answers not_found for another seller’s product', async () => {
    const { db } = transactionalDb({ product: null });

    expect(await save(db, PANTS_AXES, PANTS_ASSIGNMENTS)).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });

  it('refuses a stale version rather than overwriting a concurrent edit', async () => {
    const { db } = transactionalDb({ variants: PANTS_VARIANTS });

    expect(await save(db, PANTS_AXES, PANTS_ASSIGNMENTS, 7)).toEqual({
      ok: false,
      reason: 'version_conflict',
    });
  });

  it('refuses no axes at all', async () => {
    const { db } = transactionalDb({ variants: PANTS_VARIANTS });

    expect(await save(db, [], [])).toEqual({ ok: false, reason: 'NO_AXES' });
  });

  it('refuses a blank axis name and a blank value', async () => {
    const { db } = transactionalDb({ variants: PANTS_VARIANTS });

    expect(
      await save(db, [{ name: '  ', values: ['Black'] }], []),
    ).toMatchObject({ ok: false, reason: 'EMPTY_NAME' });
    expect(
      await save(db, [{ name: 'Colour', values: ['Black', ' '] }], []),
    ).toMatchObject({ ok: false, reason: 'EMPTY_VALUE' });
  });

  /**
   * A dispute about what a buyer was shown has to be able to tell a mapping
   * checked against the supplier's labels apart from one a person judged, years
   * later. One action name for both would erase that distinction permanently.
   */
  it('audits under its own action, carrying the supplier strings being reinterpreted', async () => {
    const { db } = transactionalDb({ variants: PANTS_VARIANTS });

    await save(db, PANTS_AXES, PANTS_ASSIGNMENTS);

    expect(mocks.appendAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'catalog_product.options_mapped_manually',
        entityId: PRODUCT_ID,
        payload: expect.objectContaining({
          axisCount: 3,
          mappedVariantCount: 8,
          axisNames: ['Colour', 'Fit', 'Size'],
          supplierLabels: expect.arrayContaining(['Female, Gray-L']),
        }),
      }),
    );
  });

  it('bumps the product version so the editor cannot save twice off one read', async () => {
    const { db, writes } = transactionalDb({ variants: PANTS_VARIANTS });

    await save(db, PANTS_AXES, PANTS_ASSIGNMENTS);

    const [productWrite] = writes.filter(
      (write) => write.table === products && write.values.version !== undefined,
    );

    expect(productWrite?.values.version).toBe(2);
    expect(productWrite?.values.updatedBy).toBe(ACTOR_ID);
  });
});
