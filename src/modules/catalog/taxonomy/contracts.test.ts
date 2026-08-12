import { describe, expect, it } from 'vitest';

import {
  proposeCategoryMappingSchema,
  reviewCategoryMappingSchema,
} from './contracts';

const BASE = {
  provider: 'CJ_DROPSHIPPING',
  externalCategoryId: 'cj-cat-1042',
  observedCategoryPath: 'Luggage & Bags > Backpacks',
  taxonomyVersion: 'sals3-taxonomy-v0',
  method: 'EXTERNAL_ID_RULE',
  confidence: 'EXACT',
  sals3CategoryCode: 'CAT-MEN-100564',
  reason: 'Reviewed against the CJ category tree export.',
  evidenceReference: null,
  actorId: 'actor-1',
  expectedCurrentVersion: 0,
};

describe('proposeCategoryMappingSchema', () => {
  it('accepts a reviewed, evidence-backed proposal', () => {
    expect(proposeCategoryMappingSchema.safeParse(BASE).success).toBe(true);
  });

  it('has no fuzzy or name-similarity method — an uncontrolled text match is not expressible', () => {
    ['NAME_SIMILARITY', 'FUZZY', 'INFERRED', 'AUTO', 'GEMINI'].forEach(
      (method) => {
        expect(
          proposeCategoryMappingSchema.safeParse({ ...BASE, method }).success,
        ).toBe(false);
      },
    );
  });

  it('rejects a category named by free text or a path fragment instead of a stable code', () => {
    [
      "Bags & Travel > Men's Bags",
      'Backpacks',
      'cat-men-100564 OR 1=1',
      '../../etc/passwd',
      'CAT MEN 100564',
    ].forEach((sals3CategoryCode) => {
      expect(
        proposeCategoryMappingSchema.safeParse({ ...BASE, sals3CategoryCode })
          .success,
      ).toBe(false);
    });
  });

  it('rejects an unapproved provider', () => {
    expect(
      proposeCategoryMappingSchema.safeParse({
        ...BASE,
        provider: 'ALIEXPRESS',
      }).success,
    ).toBe(false);
  });

  it('requires a real justification, not an empty or token reason', () => {
    ['', '   ', 'ok'].forEach((reason) => {
      expect(
        proposeCategoryMappingSchema.safeParse({ ...BASE, reason }).success,
      ).toBe(false);
    });
  });

  it('rejects a blank supplier category identity', () => {
    ['', '   '].forEach((externalCategoryId) => {
      expect(
        proposeCategoryMappingSchema.safeParse({ ...BASE, externalCategoryId })
          .success,
      ).toBe(false);
    });
  });

  it('will not let an ambiguous or unmapped decision carry a category code', () => {
    ['AMBIGUOUS', 'UNMAPPED'].forEach((confidence) => {
      expect(
        proposeCategoryMappingSchema.safeParse({ ...BASE, confidence }).success,
      ).toBe(false);
      expect(
        proposeCategoryMappingSchema.safeParse({
          ...BASE,
          confidence,
          sals3CategoryCode: null,
        }).success,
      ).toBe(true);
    });
  });

  it('will not let a confident decision omit the category code', () => {
    ['EXACT', 'ACCEPTABLE'].forEach((confidence) => {
      expect(
        proposeCategoryMappingSchema.safeParse({
          ...BASE,
          confidence,
          sals3CategoryCode: null,
        }).success,
      ).toBe(false);
    });
  });

  it('has no field through which a market, price, margin or publication claim could arrive', () => {
    const parsed = proposeCategoryMappingSchema.safeParse({
      ...BASE,
      marketCode: 'AU',
      targetMarginRate: '0.30',
      publish: true,
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty('marketCode');
      expect(parsed.data).not.toHaveProperty('targetMarginRate');
      expect(parsed.data).not.toHaveProperty('publish');
    }
  });
});

describe('reviewCategoryMappingSchema', () => {
  const REVIEW = {
    mappingId: '00000000-0000-4000-8000-000000000002',
    expectedMappingVersion: 2,
    decision: 'APPROVE_AND_ACTIVATE',
    reason: 'Reviewed against the CJ category tree export.',
    reviewedBy: 'reviewer-1',
  };

  it('accepts an approve and a reject decision', () => {
    expect(reviewCategoryMappingSchema.safeParse(REVIEW).success).toBe(true);
    expect(
      reviewCategoryMappingSchema.safeParse({ ...REVIEW, decision: 'REJECT' })
        .success,
    ).toBe(true);
  });

  it('requires a compare-and-set version, so a review cannot be applied blind', () => {
    [undefined, 0, -1, 1.5].forEach((expectedMappingVersion) => {
      expect(
        reviewCategoryMappingSchema.safeParse({
          ...REVIEW,
          expectedMappingVersion,
        }).success,
      ).toBe(false);
    });
  });

  it('offers no decision that publishes, approves for sale, or changes a market', () => {
    ['PUBLISH', 'APPROVE_FOR_SALE', 'ENABLE_MARKET'].forEach((decision) => {
      expect(
        reviewCategoryMappingSchema.safeParse({ ...REVIEW, decision }).success,
      ).toBe(false);
    });
  });
});
