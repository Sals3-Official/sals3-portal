import { describe, expect, it } from 'vitest';
import {
  categoryAttributeUnresolvedPlaceholder,
  categoryAttributeValueDisplayLabel,
} from './attribute-display-defaults';

describe('categoryAttributeValueDisplayLabel', () => {
  it('shows Generic for the raw UNBRANDED token on the Brand attribute', () => {
    expect(categoryAttributeValueDisplayLabel('Brand', 'UNBRANDED')).toBe(
      'Generic',
    );
  });

  it('shows Generic for the raw UNBRANDED token on Brand / Publisher too', () => {
    expect(
      categoryAttributeValueDisplayLabel('Brand / Publisher', 'UNBRANDED'),
    ).toBe('Generic');
  });

  it('leaves a real brand value untouched', () => {
    expect(categoryAttributeValueDisplayLabel('Brand', 'Royal Canin')).toBe(
      'Royal Canin',
    );
  });

  it('never remaps UNBRANDED on an unrelated attribute', () => {
    expect(categoryAttributeValueDisplayLabel('Material', 'UNBRANDED')).toBe(
      'UNBRANDED',
    );
  });

  it('leaves Country of Origin values untouched — only its unresolved placeholder changes', () => {
    expect(
      categoryAttributeValueDisplayLabel('Country of Origin', 'Vietnam'),
    ).toBe('Vietnam');
  });
});

describe('categoryAttributeUnresolvedPlaceholder', () => {
  it('defaults an unresolved Brand attribute to Generic', () => {
    expect(categoryAttributeUnresolvedPlaceholder('Brand')).toBe('Generic');
  });

  it('defaults an unresolved Brand / Publisher attribute to Generic', () => {
    expect(categoryAttributeUnresolvedPlaceholder('Brand / Publisher')).toBe(
      'Generic',
    );
  });

  it('defaults an unresolved Country of Origin attribute to Others', () => {
    expect(categoryAttributeUnresolvedPlaceholder('Country of Origin')).toBe(
      'Others',
    );
  });

  it('falls back to the generic placeholder for every other attribute', () => {
    expect(categoryAttributeUnresolvedPlaceholder('Screen Size')).toBe(
      'Select a value',
    );
  });
});
