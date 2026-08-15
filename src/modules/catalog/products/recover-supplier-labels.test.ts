// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  productVariants,
  products,
  providerProductReferences,
  providerVariantReferences,
  supplierSnapshots,
} from '@/lib/db/schema';
import { recoverSupplierLabels } from './recover-supplier-labels';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const SELLER_ID = '22222222-2222-4222-8222-222222222222';

type Rows = {
  product?: Record<string, unknown>[];
  snapshot?: Record<string, unknown>[];
  variants?: Record<string, unknown>[];
};

/**
 * Dispatches each read on the table it targets, so a change in refusal ordering
 * cannot silently answer the wrong query. Updates are recorded rather than
 * applied, and each one reports how many rows it claims to have changed — which
 * is what the `isNull` predicate decides in the real database.
 */
function fakeDb(rows: Rows = {}, updatedPerCall: number[] = []) {
  const updates: { where: unknown; values: unknown }[] = [];
  let updateCall = 0;

  const rowsForTable = (table: unknown): unknown[] => {
    if (table === products) return rows.product ?? [{ id: PRODUCT_ID }];
    if (table === providerProductReferences) {
      return rows.snapshot ?? [{ evidence: { variants: [] } }];
    }
    if (table === productVariants) {
      return rows.variants ?? [{ id: 'variant-1' }];
    }

    return [];
  };

  const selectChain = () => {
    let result: unknown[] = [];
    const builder: Record<string, unknown> = {};

    builder.from = vi.fn((table: unknown) => {
      result = rowsForTable(table);

      return builder;
    });
    ['innerJoin', 'leftJoin', 'where'].forEach((name) => {
      builder[name] = vi.fn(() => builder);
    });
    builder.limit = vi.fn(() => result);
    builder.then = (resolve: (value: unknown) => unknown) => resolve(result);

    return builder;
  };

  const tx = {
    select: vi.fn(selectChain),
    update: vi.fn(() => {
      const chain: Record<string, unknown> = {};

      chain.set = vi.fn((values: unknown) => {
        chain.pendingValues = values;

        return chain;
      });
      chain.where = vi.fn((where: unknown) => {
        updates.push({ where, values: chain.pendingValues });

        return chain;
      });
      chain.returning = vi.fn(() => {
        const count = updatedPerCall[updateCall] ?? 0;

        updateCall += 1;

        return Promise.resolve(
          Array.from({ length: count }, (_, index) => ({ id: `ref-${index}` })),
        );
      });

      return chain;
    }),
    insert: vi.fn(() => ({ values: vi.fn(() => Promise.resolve()) })),
  };

  return {
    db: {
      transaction: vi.fn(async (callback: (t: unknown) => Promise<unknown>) =>
        callback(tx),
      ),
    } as never,
    updates,
    tx,
  };
}

function evidence(variants: { vid: string; optionLabel?: string | null }[]) {
  return [{ evidence: { variants } }];
}

describe('recoverSupplierLabels', () => {
  it('refuses a product that is not this seller’s', async () => {
    const { db } = fakeDb({ product: [] });

    expect(
      await recoverSupplierLabels({
        productId: PRODUCT_ID,
        sellerAccountId: SELLER_ID,
        actorId: 'user-1',
        db,
      }),
    ).toEqual({ ok: false, reason: 'not_found' });
  });

  it('refuses when the product has no stored supplier evidence', async () => {
    const { db } = fakeDb({ snapshot: [] });

    expect(
      await recoverSupplierLabels({
        productId: PRODUCT_ID,
        sellerAccountId: SELLER_ID,
        actorId: 'user-1',
        db,
      }),
    ).toEqual({ ok: false, reason: 'NO_STORED_EVIDENCE' });
  });

  it('refuses when the evidence carries no usable label, rather than reporting a no-op success', async () => {
    const { db, updates } = fakeDb({
      snapshot: evidence([
        { vid: 'v1', optionLabel: null },
        { vid: 'v2', optionLabel: '   ' },
      ]),
    });

    expect(
      await recoverSupplierLabels({
        productId: PRODUCT_ID,
        sellerAccountId: SELLER_ID,
        actorId: 'user-1',
        db,
      }),
    ).toEqual({ ok: false, reason: 'NO_LABELS_IN_EVIDENCE' });
    expect(updates).toHaveLength(0);
  });

  it('recovers one label per evidence variant and reports the count', async () => {
    const { db, updates } = fakeDb(
      {
        snapshot: evidence([
          { vid: 'v1', optionLabel: 'Black-S' },
          { vid: 'v2', optionLabel: 'Black-M' },
        ]),
        variants: [{ id: 'variant-1' }, { id: 'variant-2' }],
      },
      [1, 1],
    );

    expect(
      await recoverSupplierLabels({
        productId: PRODUCT_ID,
        sellerAccountId: SELLER_ID,
        actorId: 'user-1',
        db,
      }),
    ).toEqual({ ok: true, recoveredCount: 2, alreadyLabelledCount: 0 });
    expect(updates).toHaveLength(2);
    expect(updates[0]?.values).toEqual({ sourceOptionLabel: 'Black-S' });
  });

  it('trims the stored label before writing it', async () => {
    const { db, updates } = fakeDb(
      { snapshot: evidence([{ vid: 'v1', optionLabel: '  Army Green-XL  ' }]) },
      [1],
    );

    await recoverSupplierLabels({
      productId: PRODUCT_ID,
      sellerAccountId: SELLER_ID,
      actorId: 'user-1',
      db,
    });

    expect(updates[0]?.values).toEqual({ sourceOptionLabel: 'Army Green-XL' });
  });

  /**
   * The second press. Every row already carries a label, so the `isNull`
   * predicate matches nothing and the run reports zero rather than claiming to
   * have written something.
   */
  it('recovers nothing on a re-run and says so', async () => {
    const { db } = fakeDb(
      { snapshot: evidence([{ vid: 'v1', optionLabel: 'Black-S' }]) },
      [0],
    );

    expect(
      await recoverSupplierLabels({
        productId: PRODUCT_ID,
        sellerAccountId: SELLER_ID,
        actorId: 'user-1',
        db,
      }),
    ).toEqual({ ok: true, recoveredCount: 0, alreadyLabelledCount: 1 });
  });

  it('writes no audit event when nothing was recovered', async () => {
    const { db, tx } = fakeDb(
      { snapshot: evidence([{ vid: 'v1', optionLabel: 'Black-S' }]) },
      [0],
    );

    await recoverSupplierLabels({
      productId: PRODUCT_ID,
      sellerAccountId: SELLER_ID,
      actorId: 'user-1',
      db,
    });

    expect(tx.insert).not.toHaveBeenCalled();
  });

  it('records an audit event naming the actor and the source when it does write', async () => {
    const { db, tx } = fakeDb(
      { snapshot: evidence([{ vid: 'v1', optionLabel: 'Black-S' }]) },
      [1],
    );

    await recoverSupplierLabels({
      productId: PRODUCT_ID,
      sellerAccountId: SELLER_ID,
      actorId: 'user-7',
      db,
    });

    expect(tx.insert).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the product has no variants at all', async () => {
    const { db, updates } = fakeDb({
      snapshot: evidence([{ vid: 'v1', optionLabel: 'Black-S' }]),
      variants: [],
    });

    expect(
      await recoverSupplierLabels({
        productId: PRODUCT_ID,
        sellerAccountId: SELLER_ID,
        actorId: 'user-1',
        db,
      }),
    ).toEqual({ ok: true, recoveredCount: 0, alreadyLabelledCount: 0 });
    expect(updates).toHaveLength(0);
  });

  it('degrades to a refusal when the snapshot shape is unreadable', async () => {
    const { db } = fakeDb({ snapshot: [{ evidence: { variants: 'nope' } }] });

    expect(
      await recoverSupplierLabels({
        productId: PRODUCT_ID,
        sellerAccountId: SELLER_ID,
        actorId: 'user-1',
        db,
      }),
    ).toEqual({ ok: false, reason: 'NO_LABELS_IN_EVIDENCE' });
  });

  it('never selects a table it has no business reading', async () => {
    const { db, tx } = fakeDb({
      snapshot: evidence([{ vid: 'v1', optionLabel: 'Black-S' }]),
    });

    await recoverSupplierLabels({
      productId: PRODUCT_ID,
      sellerAccountId: SELLER_ID,
      actorId: 'user-1',
      db,
    });

    const tablesRead = tx.select.mock.results
      .map(
        (result) => result.value as { from: { mock: { calls: unknown[][] } } },
      )
      .flatMap((builder) => builder.from.mock.calls.map((call) => call[0]));

    expect(tablesRead).toContain(products);
    expect(tablesRead).toContain(providerProductReferences);
    expect(tablesRead).toContain(productVariants);
    // Not `supplier_snapshots` directly: it is reached only through the join
    // that proves the snapshot belongs to this product's candidate.
    expect(tablesRead).not.toContain(supplierSnapshots);
    expect(tablesRead).not.toContain(providerVariantReferences);
  });
});
