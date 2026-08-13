// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DRAFT_MISSING_REQUIREMENTS } from '@/modules/catalog/products/contracts';
import toReadinessIssues, {
  deriveMissingRequirements,
} from './draft-readiness';

const EMPTY_DESCRIPTION = { version: 1 as const, blocks: [] };
const WRITTEN_DESCRIPTION = {
  version: 1 as const,
  blocks: [{ type: 'paragraph' as const, text: 'A folding chair.' }],
};

describe('deriveMissingRequirements', () => {
  it('recomputes from the current rows, so a saved description clears', () => {
    const withEmpty = deriveMissingRequirements({
      categoryMappingConfidence: 'UNMAPPED',
      variantCount: 0,
      descriptionDocument: EMPTY_DESCRIPTION,
    });
    const withWritten = deriveMissingRequirements({
      categoryMappingConfidence: 'UNMAPPED',
      variantCount: 0,
      descriptionDocument: WRITTEN_DESCRIPTION,
    });

    expect(withEmpty).toContain('STRUCTURED_DESCRIPTION_REQUIRED');
    expect(withWritten).not.toContain('STRUCTURED_DESCRIPTION_REQUIRED');
  });

  it('asks for option mapping only once variants exist', () => {
    const withoutVariants = deriveMissingRequirements({
      categoryMappingConfidence: 'UNMAPPED',
      variantCount: 0,
      descriptionDocument: WRITTEN_DESCRIPTION,
    });
    const withVariants = deriveMissingRequirements({
      categoryMappingConfidence: 'UNMAPPED',
      variantCount: 4,
      descriptionDocument: WRITTEN_DESCRIPTION,
    });

    expect(withoutVariants).toContain('NO_PERSISTED_SUPPLIER_EVIDENCE');
    expect(withoutVariants).not.toContain('PRODUCT_OPTIONS_UNMAPPED');
    expect(withVariants).toContain('PRODUCT_OPTIONS_UNMAPPED');
    expect(withVariants).not.toContain('NO_PERSISTED_SUPPLIER_EVIDENCE');
  });

  it('drops the category and pricing requirements once a category is mapped', () => {
    const mapped = deriveMissingRequirements({
      categoryMappingConfidence: 'EXACT',
      variantCount: 2,
      descriptionDocument: WRITTEN_DESCRIPTION,
    });

    expect(mapped).not.toContain('CATEGORY_MAPPING_REQUIRED');
    expect(mapped).not.toContain('PRICING_UNRESOLVED');
  });

  /**
   * `product_media_sources` has no writer anywhere in this repo, so this cannot
   * be cleared by anything a seller does. If a media flow ever ships, this
   * assertion is the reminder to make the derivation read that table.
   */
  it('always reports missing media provenance', () => {
    expect(
      deriveMissingRequirements({
        categoryMappingConfidence: 'EXACT',
        variantCount: 2,
        descriptionDocument: WRITTEN_DESCRIPTION,
      }),
    ).toContain('MEDIA_SOURCE_NOT_RECORDED');
  });
});

describe('toReadinessIssues', () => {
  it('presents every requirement code, so none can render blank', () => {
    const issues = toReadinessIssues([...DRAFT_MISSING_REQUIREMENTS]);

    expect(issues).toHaveLength(DRAFT_MISSING_REQUIREMENTS.length);
    issues.forEach((issue) => {
      expect(issue.title).not.toBe('');
      expect(issue.explanation).not.toBe('');
      expect(issue.resolution).not.toBe('');
    });
  });

  it('claims no pipeline reason code - these are Sals3 draft requirements', () => {
    toReadinessIssues([...DRAFT_MISSING_REQUIREMENTS]).forEach((issue) => {
      expect(issue.reasonCode).toBeNull();
      expect(issue.source).toBe('AUTOMATED_VALIDATION');
    });
  });

  it('sends the description issue to the one section that can fix it', () => {
    const [issue] = toReadinessIssues(['STRUCTURED_DESCRIPTION_REQUIRED']);

    expect(issue.section).toBe('description');
    expect(issue.resolution).toContain('fixable here');
  });

  it('says plainly when a requirement is not fixable in this portal', () => {
    const [issue] = toReadinessIssues(['CATEGORY_MAPPING_REQUIRED']);

    expect(issue.section).toBe('basic');
    expect(issue.resolution).toContain('does not exist in this portal yet');
  });
});
