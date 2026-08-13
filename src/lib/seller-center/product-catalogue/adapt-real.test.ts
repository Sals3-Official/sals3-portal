// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type {
  CatalogueVariantRowData,
  CataloguePricingSummary,
} from '@/modules/catalog/products/catalogue-detail-queries';
import type { CatalogueListingRow } from '@/modules/catalog/products/catalogue-queries';
import adaptRealRows from './adapt-real';
import type { NotTrackedReason } from './view';

const OBSERVED_AT = new Date('2026-08-01T10:00:00.000Z');

function listingRow(
  overrides: Partial<CatalogueListingRow> = {},
): CatalogueListingRow {
  return {
    productId: 'product-1',
    title: 'Folding Camp Chair',
    publicationState: 'UNPUBLISHED',
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-02T00:00:00.000Z'),
    version: 1,
    categoryPath: null,
    brandName: null,
    providerCode: 'CJ',
    providerDisplayName: 'CJdropshipping',
    externalProductId: '2408301234567',
    sourceStatus: 'ACTIVE',
    syncState: 'STALE',
    lastObservedAt: OBSERVED_AT,
    variantCount: 2,
    revisionWorkflowState: 'DRAFT',
    connectionStatus: 'CONNECTED',
    ...overrides,
  };
}

function variantRow(
  overrides: Partial<CatalogueVariantRowData> = {},
): CatalogueVariantRowData {
  return {
    productId: 'product-1',
    variantId: 'variant-1',
    sals3Sku: 'SALS3-0001',
    status: 'DRAFT',
    weightGrams: 900,
    sourceOptionLabel: 'Black-1XL',
    externalVariantId: 'CJ-V-1',
    lastObservedCostMinor: BigInt(1250),
    lastObservedCostCurrency: 'USD',
    lastObservedInventory: 42,
    lastObservedAt: OBSERVED_AT,
    ...overrides,
  };
}

function adaptOne(
  row: CatalogueListingRow = listingRow(),
  variants: CatalogueVariantRowData[] = [],
  pricing: CataloguePricingSummary | null = null,
) {
  const [view] = adaptRealRows(
    [row],
    variants.length === 0 ? new Map() : new Map([[row.productId, variants]]),
    pricing === null ? new Map() : new Map([[row.productId, pricing]]),
  );

  return view;
}

describe('adapt-real fabricates nothing', () => {
  /**
   * The whole reason `Tracked` exists. If a later column is added without a
   * `Tracked` wrapper it will surface as a real value here and fail this test,
   * which is the only automated defence against a plausible default.
   */
  it('marks every unrecorded dimension not-tracked, with its own reason', () => {
    const view = adaptOne();

    const expected: Array<[string, NotTrackedReason]> = [
      ['hasImage', 'NO_MEDIA_WRITERS'],
      ['mediaStatus', 'NO_MEDIA_WRITERS'],
      ['availability', 'NO_STOCK_EVIDENCE_STORE'],
      ['contentReadiness', 'NO_CONTENT_SCORING'],
      ['attentionReasons', 'NO_ATTENTION_SYSTEM'],
      ['sellingPrice', 'NO_PRICE_RESOLVED'],
    ];

    expected.forEach(([field, reason]) => {
      expect(view[field as 'availability']).toEqual({
        kind: 'not-tracked',
        reason,
      });
    });
  });

  /**
   * The placeholders the owner rejected, checked over the serialized view so a
   * new field cannot smuggle one in past the field-by-field assertions above.
   */
  it('never emits a placeholder price, availability or all-clear signal', () => {
    const serialized = JSON.stringify(
      adaptRealRows(
        [listingRow(), listingRow({ productId: 'product-2' })],
        new Map([['product-1', [variantRow()]]]),
        new Map(),
      ),
    );

    ['AVAILABLE', 'UNKNOWN_OR_STALE', '$0.00', 'Clear', 'OWN_PICTURES'].forEach(
      (placeholder) => {
        expect(serialized).not.toContain(placeholder);
      },
    );
  });

  it('separates a recorded absence from an untracked dimension', () => {
    const view = adaptOne(
      listingRow({
        categoryPath: null,
        externalProductId: null,
        providerDisplayName: null,
        connectionStatus: null,
      }),
    );

    expect(view.categoryPath).toEqual({
      kind: 'absent',
      label: 'Not mapped yet',
    });
    expect(view.supplierReference).toEqual({
      kind: 'absent',
      label: 'No supplier reference',
    });
    expect(view.supplierProviderName.kind).toBe('absent');
    expect(view.supplierConnectionHealth.kind).toBe('absent');
  });

  it('keeps a real category path and a real connection status', () => {
    const view = adaptOne(
      listingRow({
        categoryPath: 'Outdoor > Camping > Chairs',
        connectionStatus: 'REAUTH_REQUIRED',
      }),
    );

    expect(view.categoryPath).toEqual({
      kind: 'value',
      value: 'Outdoor > Camping > Chairs',
    });
    expect(view.supplierConnectionHealth).toEqual({
      kind: 'value',
      value: 'REAUTH_REQUIRED',
    });
  });
});

describe('adapt-real pricing', () => {
  it('is not-tracked when the product has no offer at all', () => {
    expect(adaptOne().sellingPrice).toEqual({
      kind: 'not-tracked',
      reason: 'NO_PRICE_RESOLVED',
    });
  });

  it('shows the resolver own reason when offers exist but nothing resolved', () => {
    const view = adaptOne(listingRow(), [], {
      offerCount: 2,
      resolvedCount: 0,
      lowestPriceMinor: null,
      priceCurrency: null,
      unresolvedReason: 'NO_CATEGORY_MAPPING',
    });

    expect(view.sellingPrice).toEqual({
      kind: 'absent',
      label: 'No price yet: NO_CATEGORY_MAPPING',
    });
  });

  it('shows a resolved price as real money', () => {
    const view = adaptOne(listingRow(), [], {
      offerCount: 2,
      resolvedCount: 1,
      lowestPriceMinor: BigInt(2599),
      priceCurrency: 'USD',
      unresolvedReason: null,
    });

    expect(view.sellingPrice).toEqual({
      kind: 'value',
      value: { amountMinor: 2599, currency: 'USD' },
    });
  });
});

describe('adapt-real variants', () => {
  it('carries observed supplier facts and withholds the rest', () => {
    const [variant] = adaptOne(listingRow(), [variantRow()]).variants;

    expect(variant.sellerSku).toEqual({ kind: 'value', value: 'SALS3-0001' });
    expect(variant.optionLabel).toEqual({ kind: 'value', value: 'Black-1XL' });
    expect(variant.supplierCost).toEqual({
      kind: 'value',
      value: { amountMinor: 1250, currency: 'USD' },
    });
    expect(variant.supplierObservedQuantity).toEqual({
      kind: 'value',
      value: 42,
    });
    expect(variant.availability.kind).toBe('not-tracked');
    expect(variant.sellingPrice.kind).toBe('not-tracked');
  });

  it('states an unobserved cost and quantity instead of zero', () => {
    const [variant] = adaptOne(listingRow(), [
      variantRow({
        lastObservedCostMinor: null,
        lastObservedCostCurrency: null,
        lastObservedInventory: null,
        lastObservedAt: null,
        sourceOptionLabel: null,
      }),
    ]).variants;

    expect(variant.supplierCost).toEqual({
      kind: 'absent',
      label: 'Cost not observed',
    });
    expect(variant.supplierObservedQuantity.kind).toBe('absent');
    expect(variant.lastCheckedAt).toEqual({ kind: 'absent', label: 'never' });
    expect(variant.optionLabel.kind).toBe('absent');
  });

  it('renders the variant control disabled with a reason, never missing', () => {
    const [variant] = adaptOne(listingRow(), [variantRow()]).variants;

    expect(variant.action.isDisabled).toBe(true);
    expect(variant.action.disabledReason).toContain('not built yet');
  });
});

describe('adapt-real actions and status', () => {
  it('offers Archive on a live row and hides it once archived', () => {
    expect(
      adaptOne(listingRow({ publicationState: 'PUBLISHED' })).actions.archive
        .kind,
    ).toBe('enabled');
    expect(
      adaptOne(listingRow({ publicationState: 'ARCHIVED' })).actions.archive
        .kind,
    ).toBe('hidden');
  });

  it('greys Pause and Publish with a reason rather than hiding them', () => {
    const { actions } = adaptOne(
      listingRow({ publicationState: 'UNPUBLISHED' }),
    );

    expect(actions.pause).toEqual({
      kind: 'disabled',
      suffix: ' — publishing is unbuilt',
    });
    expect(actions.publish.kind).toBe('disabled');
    expect(actions.editPrice.kind).toBe('hidden');
  });

  it('edits through the real product route, never a fixture key', () => {
    expect(adaptOne().actions.editHref).toBe('/listings/product-1');
  });

  it('asks for a pause reason only on a paused row', () => {
    expect(
      adaptOne(listingRow({ publicationState: 'PAUSED' })).pauseReason,
    ).toEqual({ kind: 'not-tracked', reason: 'NO_MANUAL_PAUSE_COLUMN' });
    expect(adaptOne().pauseReason).toEqual({ kind: 'value', value: null });
  });

  it('prints the supplier evidence it genuinely holds', () => {
    expect(adaptOne().evidenceNotes).toEqual([
      'Supplier-side status: ACTIVE',
      'Evidence: STALE',
      `Evidence captured: ${OBSERVED_AT.toISOString()}`,
    ]);
  });

  it('says evidence was never captured instead of implying freshness', () => {
    expect(
      adaptOne(listingRow({ lastObservedAt: null })).evidenceNotes,
    ).toContain('Supplier evidence: never captured');
  });
});
