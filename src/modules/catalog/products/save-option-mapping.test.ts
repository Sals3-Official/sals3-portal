// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  productOptions,
  productOptionValues,
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

const saveOptionMapping = (await import('./save-option-mapping')).default;

const PRODUCT_ID = 'a1a1a1a1-1111-4111-8111-111111111111';
const SELLER_ID = 'b2b2b2b2-2222-4222-8222-222222222222';
const ACTOR_ID = 'actor-1';

function productRow(overrides: Record<string, unknown> = {}) {
  return { id: PRODUCT_ID, version: 1, ...overrides };
}

type Overrides = {
  product?: Record<string, unknown> | null;
  existingOptions?: Record<string, unknown>[];
  variants?: { variantId: string; label: string | null }[];
};

/**
 * Dispatches each read on the table it targets and records every write,
 * mirroring the pattern `publish.test.ts` uses for the same module family:
 * assertions are about what `saveOptionMapping` decided to write, not about
 * Postgres itself.
 */
function transactionalDb(overrides: Overrides = {}) {
  const writes: { table: unknown; values: Record<string, unknown> }[] = [];
  const idCounters = { option: 0, value: 0 };

  const rowsForTable = (table: unknown): unknown[] => {
    if (table === products) {
      if (overrides.product === null) return [];

      return [overrides.product ?? productRow()];
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
    // `loadVariantLabels` awaits the builder directly with no `.limit()`.
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
      // `product_variant_option_values` inserts with no `.returning()`.
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
  axes: {
    name: string;
    values: { raw: string; label: string }[];
  }[],
  expectedProductVersion = 1,
) {
  return saveOptionMapping({
    productId: PRODUCT_ID,
    sellerAccountId: SELLER_ID,
    actorId: ACTOR_ID,
    expectedProductVersion,
    axes,
    db: db as never,
  });
}

/** The real corduroy jacket's labels: two colours by five sizes, no drops. */
function corduroyVariants() {
  return [
    'Black-S',
    'Black-M',
    'Black-L',
    'Black-XL',
    'Black-XXL',
    'Army Green-S',
    'Army Green-M',
    'Army Green-L',
    'Army Green-XL',
    'Army Green-XXL',
  ].map((label, index) => ({ variantId: `variant-${index + 1}`, label }));
}

const CORDUROY_AXES = [
  {
    name: 'Colour',
    values: [
      { raw: 'Black', label: 'Black' },
      { raw: 'Army Green', label: 'Army Green' },
    ],
  },
  {
    name: 'Size',
    values: [
      { raw: 'S', label: 'S' },
      { raw: 'M', label: 'M' },
      { raw: 'L', label: 'L' },
      { raw: 'XL', label: 'XL' },
      { raw: 'XXL', label: 'XXL' },
    ],
  },
];

/**
 * The Winter Khaki Jacket: one colour, five sizes — trimmed to three here.
 * `Khaki` sits at label position 0 and is dropped, so the one surviving axis
 * (`Size`) is offered at label position 1 while the seller's single submitted
 * axis sits at array index 0. Array index and label position disagree here,
 * which is exactly the case the old bug got wrong: it keyed the write loop's
 * map by array index, so the link loop — which walks true label position —
 * missed on every lookup and silently produced zero mapped variants.
 */
function khakiVariants() {
  return ['Khaki-M', 'Khaki-S', 'Khaki-L'].map((label, index) => ({
    variantId: `variant-${index + 1}`,
    label,
  }));
}

const KHAKI_AXES = [
  {
    name: 'Size',
    values: [
      { raw: 'M', label: 'M' },
      { raw: 'S', label: 'S' },
      { raw: 'L', label: 'L' },
    ],
  },
];

/**
 * The Outdoor Sports Face Mask, reported from UAT on 2026-08-18: five colours,
 * no delimiter at all. `deriveOptionSplit` refused this shape until that day, so
 * the editor never offered a Save for it and this write path was unreachable.
 * Now that it is reachable, it is tested.
 */
function maskVariants() {
  return ['Black', 'Blue', 'Green', 'Grey', 'Purple'].map((label, index) => ({
    variantId: `variant-${index + 1}`,
    label,
  }));
}

const MASK_AXES = [
  {
    name: 'Colour',
    values: [
      { raw: 'Black', label: 'Black' },
      { raw: 'Blue', label: 'Blue' },
      { raw: 'Green', label: 'Green' },
      { raw: 'Grey', label: 'Grey' },
      { raw: 'Purple', label: 'Purple' },
    ],
  },
];

describe('saveOptionMapping', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps a full, undropped grid — array index and label position agree throughout', async () => {
    const { db, writes } = transactionalDb({ variants: corduroyVariants() });

    const result = await save(db, CORDUROY_AXES);

    expect(result).toMatchObject({
      ok: true,
      axisCount: 2,
      mappedVariantCount: 10,
    });

    const optionWrites = writes.filter(
      (write) => write.table === productOptions,
    );
    expect(optionWrites.map((write) => write.values.position)).toEqual([0, 1]);

    const linkWrites = writes.filter(
      (write) => write.table === productVariantOptionValues,
    );
    // 10 variants x 2 axes each.
    expect(linkWrites).toHaveLength(20);

    const variantUpdates = writes.filter(
      (write) => write.table === productVariants,
    );
    expect(variantUpdates).toHaveLength(10);
    variantUpdates.forEach((write) => {
      expect(write.values.optionCombinationKey).toEqual(expect.any(String));
    });
  });

  /**
   * The regression this whole fix is for. Before it, this exact case mapped
   * `mappedVariantCount: 0` — the seller's mapping "succeeded" and no variant
   * was ever actually linked, because the write loop's map keys used the
   * axis's array index (0) while the link loop looked them up by the
   * supplier's true label position (1).
   */
  it('drops the constant Khaki position and still links every variant to Size', async () => {
    const { db, writes } = transactionalDb({ variants: khakiVariants() });

    const result = await save(db, KHAKI_AXES);

    expect(result).toMatchObject({
      ok: true,
      axisCount: 1,
      mappedVariantCount: 3,
    });

    // `productOptions.position` is the seller's own display order (array
    // index 0), never the dropped supplier label position (1).
    const optionWrite = writes.find((write) => write.table === productOptions);
    expect(optionWrite?.values).toMatchObject({ name: 'Size', position: 0 });

    const linkWrites = writes.filter(
      (write) => write.table === productVariantOptionValues,
    );
    expect(linkWrites).toHaveLength(3);
    expect(new Set(linkWrites.map((write) => write.values.variantId))).toEqual(
      new Set(['variant-1', 'variant-2', 'variant-3']),
    );

    const variantUpdates = writes.filter(
      (write) => write.table === productVariants,
    );
    expect(variantUpdates).toHaveLength(3);
    // Every variant actually got a combination key — the exact thing the old
    // bug silently failed to do.
    variantUpdates.forEach((write) => {
      expect(write.values.optionCombinationKey).toEqual(expect.any(String));
    });
    // Each of the three sizes is distinct, not all three colliding on one key.
    expect(
      new Set(variantUpdates.map((write) => write.values.optionCombinationKey)),
    ).toHaveLength(3);
  });

  /**
   * Six colours, one size — the constant position is trailing instead of
   * leading, so the surviving axis keeps label position 0. Array index and
   * label position happen to agree here too, unlike the Khaki case above, so
   * this alone would not have caught the old bug — it is here for coverage of
   * the other dropped-position shape, not as the primary regression proof.
   */
  it('drops a trailing constant position (many colours, one size)', async () => {
    const variants = ['Red-M', 'Black-M', 'Grey-M'].map((label, index) => ({
      variantId: `variant-${index + 1}`,
      label,
    }));
    const { db } = transactionalDb({ variants });

    const result = await save(db, [
      {
        name: 'Colour',
        values: [
          { raw: 'Red', label: 'Red' },
          { raw: 'Black', label: 'Black' },
          { raw: 'Grey', label: 'Grey' },
        ],
      },
    ]);

    expect(result).toMatchObject({
      ok: true,
      axisCount: 1,
      mappedVariantCount: 3,
    });
  });

  it('maps a single-axis product, linking every variant to its one option', async () => {
    const { db, writes } = transactionalDb({ variants: maskVariants() });

    const result = await save(db, MASK_AXES);

    expect(result).toMatchObject({
      ok: true,
      axisCount: 1,
      mappedVariantCount: 5,
    });

    // One option at position 0, five values, one link per variant - a
    // single-token label has exactly one position to key on.
    const optionWrites = writes.filter(
      (write) => write.table === productOptions,
    );
    expect(optionWrites.map((write) => write.values.position)).toEqual([0]);

    const linkWrites = writes.filter(
      (write) => write.table === productVariantOptionValues,
    );
    expect(linkWrites).toHaveLength(5);

    // Every variant earns a combination key, so none is left unmapped with a
    // mapping that reported success - the failure mode the Khaki case had.
    const variantUpdates = writes.filter(
      (write) => write.table === productVariants,
    );
    expect(variantUpdates).toHaveLength(5);
    variantUpdates.forEach((write) => {
      expect(write.values.optionCombinationKey).toEqual(expect.any(String));
    });
  });

  it('answers not_found for a missing or foreign product', async () => {
    const { db } = transactionalDb({ product: null });

    expect(await save(db, CORDUROY_AXES)).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });

  it('refuses a stale version rather than overwriting a concurrent edit', async () => {
    const { db } = transactionalDb({ product: productRow({ version: 5 }) });

    expect(await save(db, CORDUROY_AXES, 1)).toEqual({
      ok: false,
      reason: 'version_conflict',
    });
  });

  it('refuses a product that already has options mapped', async () => {
    const { db } = transactionalDb({
      existingOptions: [{ id: 'option-existing' }],
      variants: corduroyVariants(),
    });

    expect(await save(db, CORDUROY_AXES)).toEqual({
      ok: false,
      reason: 'ALREADY_MAPPED',
    });
  });

  it('refuses when the supplier labels do not form a complete grid', async () => {
    const { db } = transactionalDb({
      variants: [
        { variantId: 'variant-1', label: 'Black-S' },
        { variantId: 'variant-2', label: 'Red' },
      ],
    });

    const result = await save(db, CORDUROY_AXES);

    expect(result).toMatchObject({ ok: false, reason: 'SPLIT_NOT_DERIVABLE' });
  });

  it('refuses a submitted axis count that does not match the derived grid', async () => {
    const { db } = transactionalDb({ variants: corduroyVariants() });

    const result = await save(db, [CORDUROY_AXES[0]!]);

    expect(result).toMatchObject({
      ok: false,
      reason: 'SHAPE_MISMATCH',
      detail: expect.stringContaining('Expected 2 option groups'),
    });
  });

  it('refuses submitted values that do not match the supplier tokens', async () => {
    const { db } = transactionalDb({ variants: corduroyVariants() });

    const result = await save(db, [
      { name: 'Colour', values: [{ raw: 'Black', label: 'Black' }] }, // missing Army Green
      CORDUROY_AXES[1]!,
    ]);

    expect(result).toMatchObject({ ok: false, reason: 'SHAPE_MISMATCH' });
  });

  it('audits the mapping with axis names and the derived combination count', async () => {
    const { db } = transactionalDb({ variants: khakiVariants() });

    await save(db, KHAKI_AXES);

    const call = mocks.appendAuditEvent.mock.calls.find(
      (invocation) => invocation[1].action === 'catalog_product.options_mapped',
    );

    expect(call?.[1].payload).toMatchObject({
      axisCount: 1,
      mappedVariantCount: 3,
      axisNames: ['Size'],
      combinationCount: 3,
    });
  });
});
