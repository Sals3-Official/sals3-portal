import { describe, expect, it } from 'vitest';
import { suggestMetaDescription } from './suggest-meta-description';

const BASE = {
  productName: 'Aurelis 20L Packable Daypack',
  categoryLabel: 'Backpacks',
  brandDeclaration: 'Aurelis',
  descriptionText:
    'A rugged daypack built for everyday carry. Folds flat when empty.',
  specificationHighlights: ['Black', 'Water-resistant'],
  variantHighlights: ['20L'],
};

describe('suggestMetaDescription', () => {
  it('leads with brand and product name when a real brand is declared', () => {
    const result = suggestMetaDescription(BASE);

    expect(result.startsWith('Aurelis')).toBe(true);
    expect(result).toContain('Aurelis 20L Packable Daypack');
  });

  it('omits the brand when it is a generic/no-brand declaration', () => {
    const result = suggestMetaDescription({
      ...BASE,
      brandDeclaration: 'No brand / generic',
    });

    expect(result.startsWith('Aurelis 20L Packable Daypack')).toBe(true);
  });

  it('omits the brand when it is the raw UNBRANDED workbook token', () => {
    const result = suggestMetaDescription({
      ...BASE,
      brandDeclaration: 'UNBRANDED',
    });

    expect(result.startsWith('Aurelis 20L Packable Daypack')).toBe(true);
  });

  it('includes the category and a few highlights', () => {
    const result = suggestMetaDescription(BASE);

    expect(result).toContain('Backpacks');
    expect(result).toContain('Black');
    expect(result).toContain('20L');
  });

  it('includes only the first sentence of a longer description', () => {
    const result = suggestMetaDescription(BASE);

    expect(result).toContain('A rugged daypack built for everyday carry.');
    expect(result).not.toContain('Folds flat when empty.');
  });

  it('never exceeds 160 characters, truncating on a word boundary', () => {
    const result = suggestMetaDescription({
      ...BASE,
      descriptionText:
        'A rugged daypack built for everyday carry with padded straps, a hidden laptop sleeve, and a water-resistant coated exterior that shrugs off light rain on the way to the office or the trail.',
    });

    expect(result.length).toBeLessThanOrEqual(160);
    expect(result.endsWith('…')).toBe(true);
    expect(result.endsWith(' …')).toBe(false);
  });

  it('handles missing category, specifications, and description gracefully', () => {
    const result = suggestMetaDescription({
      productName: 'Aurelis 20L Packable Daypack',
      categoryLabel: null,
      brandDeclaration: '',
      descriptionText: '',
      specificationHighlights: [],
      variantHighlights: [],
    });

    expect(result).toBe('Aurelis 20L Packable Daypack');
  });
});
