import { describe, expect, it } from 'vitest';
import {
  MARGIN_FLOOR_PERCENT,
  canBulkEnable,
  landedCost,
  marginPercent,
  marginRange,
  marketsWithRoute,
  publishDecision,
  retailRange,
  sectionSeverity,
  severityForUnresolvedSpecification,
  variantsBelowMarginFloor,
} from './derive';
import { resolveProductEditorFixture } from '../mock-data/product-editor';
import type { VariantFixture } from './types';

const BASE_VARIANT: VariantFixture = {
  id: 'v1',
  optionLabel: 'Slate / 20L',
  sellerSku: 'SKU-1',
  supplierCost: { amountMinor: 1000, currency: 'USD' },
  freightEstimate: { amountMinor: 300, currency: 'USD' },
  retailPrice: { amountMinor: 2000, currency: 'USD' },
  supplierStock: 10,
  warehouseLabel: 'CN Warehouse',
  hasImage: true,
  enabled: true,
  listingState: 'WILL_LIST',
  attention: null,
  supplierVariantId: 'SV1',
  packedWeightGrams: 400,
  evidenceCapturedAt: '2026-08-08T06:05:00.000Z',
};

function fixture(key: string) {
  const resolved = resolveProductEditorFixture(key);

  if (resolved === null) throw new Error(`missing fixture ${key}`);

  return resolved;
}

describe('landed cost and margin', () => {
  it('adds freight to supplier cost when both are known', () => {
    expect(landedCost(BASE_VARIANT)).toEqual({
      amountMinor: 1300,
      currency: 'USD',
    });
    expect(marginPercent(BASE_VARIANT)).toBeCloseTo(35, 5);
  });

  it('returns null - never zero - when there is no route evidence', () => {
    const noRoute = { ...BASE_VARIANT, freightEstimate: null };

    expect(landedCost(noRoute)).toBeNull();
    expect(marginPercent(noRoute)).toBeNull();
  });

  it('refuses to combine two different currencies', () => {
    const mixed: VariantFixture = {
      ...BASE_VARIANT,
      freightEstimate: { amountMinor: 300, currency: 'PHP' },
    };

    expect(landedCost(mixed)).toBeNull();
    expect(marginPercent(mixed)).toBeNull();
  });

  it('returns null rather than dividing by a zero retail price', () => {
    expect(
      marginPercent({
        ...BASE_VARIANT,
        retailPrice: { amountMinor: 0, currency: 'USD' },
      }),
    ).toBeNull();
  });
});

describe('ranges', () => {
  it('gives no retail range when nothing will be listed', () => {
    expect(retailRange([{ ...BASE_VARIANT, enabled: false }])).toBeNull();
  });

  it('gives no retail range across mixed currencies', () => {
    const other: VariantFixture = {
      ...BASE_VARIANT,
      id: 'v2',
      retailPrice: { amountMinor: 5000, currency: 'PHP' },
    };

    expect(retailRange([BASE_VARIANT, other])).toBeNull();
  });

  it('gives no margin range when no enabled variant has a computable margin', () => {
    expect(
      marginRange([{ ...BASE_VARIANT, freightEstimate: null }]),
    ).toBeNull();
  });
});

describe('bulk enable safety', () => {
  it('never re-enables a blocked or paused variant', () => {
    expect(canBulkEnable({ ...BASE_VARIANT, listingState: 'BLOCKED' })).toBe(
      false,
    );
    expect(canBulkEnable({ ...BASE_VARIANT, listingState: 'PAUSED' })).toBe(
      false,
    );
  });

  it('never re-enables an out-of-stock variant', () => {
    expect(canBulkEnable({ ...BASE_VARIANT, supplierStock: 0 })).toBe(false);
  });

  it('enables an in-stock, unblocked variant', () => {
    expect(canBulkEnable(BASE_VARIANT)).toBe(true);
  });
});

describe('specification severity', () => {
  it('treats a missing required attribute as a blocker, not a warning', () => {
    expect(severityForUnresolvedSpecification('REQUIRED')).toBe('BLOCKER');
  });

  it('treats a missing recommended attribute as a warning', () => {
    expect(severityForUnresolvedSpecification('RECOMMENDED')).toBe('WARNING');
  });

  it('treats a missing optional attribute as a suggestion', () => {
    expect(severityForUnresolvedSpecification('OPTIONAL')).toBe('SUGGESTION');
  });
});

describe('publish decision', () => {
  it('offers Publish Product for a clean pass', () => {
    const decision = publishDecision(fixture('pass'));

    expect(decision.canPublish).toBe(true);
    expect(decision.label).toBe('Publish Product');
    expect(decision.blockerCount).toBe(0);
    expect(decision.warningCount).toBe(0);
    expect(decision.blockedReason).toBeNull();
  });

  it('offers Publish with Attention when warnings exist but nothing blocks', () => {
    const decision = publishDecision(fixture('attention'));

    expect(decision.canPublish).toBe(true);
    expect(decision.label).toBe('Publish with Attention');
    expect(decision.warningCount).toBeGreaterThan(0);
  });

  it('blocks publication and states why, rather than going quiet', () => {
    const decision = publishDecision(fixture('blocked'));

    expect(decision.canPublish).toBe(false);
    expect(decision.blockerCount).toBe(3);
    expect(decision.blockedReason).toBe('3 hard blockers must clear first');
  });

  it('offers Publish Update for an already published listing', () => {
    const decision = publishDecision(fixture('delisted'));

    expect(decision.label).toBe('Publish Update');
    expect(decision.saveLabel).toBe('Save New Draft');
  });

  it('blocks publication while the supplier connection is unreachable', () => {
    const decision = publishDecision(fixture('pass'), 'CONNECTION_UNAVAILABLE');

    expect(decision.canPublish).toBe(false);
    expect(decision.blockedReason).toContain('Supplier connection unavailable');
  });
});

describe('fixtures agree with what is derived from them', () => {
  it('counts exactly the two below-floor variants the attention warning names', () => {
    const attention = fixture('attention');
    const below = variantsBelowMarginFloor(attention.variants);

    expect(below).toHaveLength(2);
    expect(below.map((variant) => variant.optionLabel)).toEqual([
      'Slate / 28L',
      'Clay / 28L',
    ]);
    below.forEach((variant) => {
      expect(marginPercent(variant)).toBeLessThan(MARGIN_FLOOR_PERCENT);
    });
  });

  it('reports the missing required attribute in the blocked fixture as a section blocker', () => {
    const blocked = fixture('blocked');
    const missingRequired = blocked.specifications.filter(
      (spec) => spec.requirement === 'REQUIRED' && spec.unresolved,
    );

    expect(missingRequired).toHaveLength(1);
    expect(sectionSeverity(blocked.issues, 'specs')).toBe('BLOCKER');
  });

  it('keeps the missing recommended attribute a warning, never a blocker', () => {
    const attention = fixture('attention');
    const missingRecommended = attention.specifications.filter(
      (spec) => spec.requirement === 'RECOMMENDED' && spec.unresolved,
    );

    expect(missingRecommended).toHaveLength(1);
    expect(sectionSeverity(attention.issues, 'specs')).toBe('WARNING');
    expect(publishDecision(attention).canPublish).toBe(true);
  });

  it('leaves no market with route evidence when every route is gone', () => {
    expect(marketsWithRoute(fixture('blocked').markets)).toHaveLength(0);
  });

  it('keeps one routed market when only one market lost its route', () => {
    const marketRoute = fixture('market-route');

    expect(marketsWithRoute(marketRoute.markets)).toHaveLength(1);
    expect(publishDecision(marketRoute).canPublish).toBe(true);
  });
});
