// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
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

const unmapOptionMapping = (await import('./unmap-option-mapping')).default;

const PRODUCT_ID = 'a1a1a1a1-1111-4111-8111-111111111111';
const SELLER_ID = 'b2b2b2b2-2222-4222-8222-222222222222';
const ACTOR_ID = 'actor-1';

/**
 * A saved 2 x 2 matrix, in the row shape the module's own query returns: one row
 * per variant x option, joined out of the three option tables.
 */
const MAPPING_ROWS = [
  {
    optionId: 'option-1',
    optionName: 'Colour',
    optionPosition: 0,
    valueId: 'value-1',
    valueLabel: 'Black',
    valueNormalized: 'black',
    valuePosition: 0,
    variantId: 'variant-1',
  },
  {
    optionId: 'option-1',
    optionName: 'Colour',
    optionPosition: 0,
    valueId: 'value-2',
    valueLabel: 'Army Green',
    valueNormalized: 'army green',
    valuePosition: 1,
    variantId: 'variant-2',
  },
  {
    optionId: 'option-2',
    optionName: 'Size',
    optionPosition: 1,
    valueId: 'value-3',
    valueLabel: 'L',
    valueNormalized: 'l',
    valuePosition: 0,
    variantId: 'variant-1',
  },
  {
    optionId: 'option-2',
    optionName: 'Size',
    optionPosition: 1,
    valueId: 'value-4',
    valueLabel: 'XL',
    valueNormalized: 'xl',
    valuePosition: 1,
    variantId: 'variant-2',
  },
];

type Overrides = {
  product?: Record<string, unknown> | null;
  mapping?: unknown[];
  variants?: { id: string }[];
};

/**
 * Records every write **in order**, because the ordering is the correctness
 * property here: `product_variant_option_values` references both option tables
 * with `ON DELETE restrict`, so the pairs have to go before the options or the
 * real database refuses the second delete.
 */
function transactionalDb(overrides: Overrides = {}) {
  const writes: { op: string; table: unknown; values?: unknown }[] = [];
  let selectCall = 0;

  const rowsForSelect = (): unknown[] => {
    selectCall += 1;

    // In call order: the product, then the mapping, then the variants.
    if (selectCall === 1) {
      if (overrides.product === null) return [];

      return [overrides.product ?? { id: PRODUCT_ID, version: 1 }];
    }

    if (selectCall === 2) return overrides.mapping ?? MAPPING_ROWS;

    return overrides.variants ?? [{ id: 'variant-1' }, { id: 'variant-2' }];
  };

  const selectChain = () => {
    let rows: unknown[] = [];
    const builder: Record<string, unknown> = {};

    builder.from = vi.fn(() => {
      rows = rowsForSelect();

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
    delete: vi.fn((table: unknown) => {
      const chain: Record<string, unknown> = {};

      chain.where = vi.fn(() => {
        writes.push({ op: 'delete', table });

        return chain;
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

  return { db, writes };
}

function unmap(
  db: unknown,
  expectedProductVersion = 1,
  reason: string | null = null,
) {
  return unmapOptionMapping({
    productId: PRODUCT_ID,
    sellerAccountId: SELLER_ID,
    actorId: ACTOR_ID,
    expectedProductVersion,
    reason,
    db: db as never,
  });
}

describe('unmapOptionMapping', () => {
  beforeEach(() => {
    mocks.appendAuditEvent.mockReset();
  });

  it('reports what it removed', async () => {
    const { db } = transactionalDb();

    expect(await unmap(db)).toEqual({
      ok: true,
      removedAxisCount: 2,
      removedValueCount: 4,
      unmappedVariantCount: 2,
    });
  });

  /**
   * The property a real Postgres would enforce and this fake cannot:
   * `product_variant_option_values.option_id` and `.option_value_id` are both
   * `ON DELETE restrict`, so deleting `product_options` first is refused. Pinned
   * because the wrong order passes every test that never touches a database — the
   * exact failure `purge-catalogue-products.mts` was broken by.
   */
  it('deletes the variant pairs before the options they reference', async () => {
    const { db, writes } = transactionalDb();

    await unmap(db);

    const deletes = writes
      .filter((write) => write.op === 'delete')
      .map((write) => write.table);

    expect(deletes).toEqual([productVariantOptionValues, productOptions]);
  });

  it('clears the combination key on every variant, not only the mapped ones', async () => {
    const { db, writes } = transactionalDb({
      // A third variant that was never linked. Its key is already null, so the
      // update is idempotent for it — and scoping the UPDATE to mapped variants
      // would leave a stale key on any variant the mapping missed.
      variants: [{ id: 'variant-1' }, { id: 'variant-2' }, { id: 'variant-3' }],
    });

    const result = await unmap(db);

    expect(result).toMatchObject({ unmappedVariantCount: 3 });

    const [variantWrite] = writes.filter(
      (write) => write.op === 'update' && write.table === productVariants,
    );

    expect(variantWrite?.values).toMatchObject({ optionCombinationKey: null });
  });

  /**
   * Nothing else holds the buyer-facing labels. `product_options` has no history
   * table, and neither mapping action records the per-value labels or which
   * variant took which — so without this copy, unmapping to fix one wrong
   * assignment would destroy the other fifty-one decisions with no way back.
   */
  it('copies the whole mapping into the audit event before destroying it', async () => {
    const { db } = transactionalDb();

    await unmap(db, 1, 'Colour and fit were the wrong way round');

    expect(mocks.appendAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'catalog_product.options_unmapped',
        entityId: PRODUCT_ID,
        payload: expect.objectContaining({
          removedAxisCount: 2,
          removedValueCount: 4,
          unmappedVariantCount: 2,
          reason: 'Colour and fit were the wrong way round',
        }),
      }),
    );

    const call = mocks.appendAuditEvent.mock.calls[0]?.[1] as {
      payload: { removed: { valueLabel: string; variantId: string }[] };
    };

    // Every pair, with the label a buyer was reading and the variant it stood
    // against — enough for a person to rebuild it by hand.
    expect(call.payload.removed).toHaveLength(4);
    expect(call.payload.removed.map((row) => row.valueLabel)).toEqual([
      'Black',
      'Army Green',
      'L',
      'XL',
    ]);
    expect(call.payload.removed[1]?.variantId).toBe('variant-2');
  });

  it('bumps the product version so a second unmap off one read cannot land', async () => {
    const { db, writes } = transactionalDb();

    await unmap(db);

    const [productWrite] = writes.filter(
      (write) => write.op === 'update' && write.table === products,
    );

    expect(productWrite?.values).toMatchObject({
      version: 2,
      updatedBy: ACTOR_ID,
    });
  });

  it('refuses a product with no mapping rather than reporting a no-op success', async () => {
    const { db, writes } = transactionalDb({ mapping: [] });

    expect(await unmap(db)).toEqual({ ok: false, reason: 'NOT_MAPPED' });
    // Nothing was written on the way to the refusal.
    expect(writes).toHaveLength(0);
    expect(mocks.appendAuditEvent).not.toHaveBeenCalled();
  });

  it('answers not_found for another seller’s product, and writes nothing', async () => {
    const { db, writes } = transactionalDb({ product: null });

    expect(await unmap(db)).toEqual({ ok: false, reason: 'not_found' });
    expect(writes).toHaveLength(0);
  });

  it('refuses a stale version rather than deleting against a moved product', async () => {
    const { db, writes } = transactionalDb();

    expect(await unmap(db, 7)).toEqual({
      ok: false,
      reason: 'version_conflict',
    });
    expect(writes).toHaveLength(0);
  });
});
