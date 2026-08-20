import { describe, expect, it } from 'vitest';
import SALS3_TAXONOMY_DEPARTMENTS from './departments';

/**
 * Pinned, in order. This is the list the storefront's "All departments" page
 * shows a buyer, so a silent addition, drop, or rename here changes a public
 * browse surface. Change it only alongside a taxonomy reseed.
 */
const DEPARTMENTS = [
  'Animals & Pet Supplies',
  'Apparel & Accessories',
  'Arts & Entertainment',
  'Baby & Toddler',
  'Business & Industrial',
  'Cameras & Optics',
  'Electronics',
  'Food, Beverages & Tobacco',
  'Furniture',
  'Hardware',
  'Health & Beauty',
  'Home & Garden',
  'Luggage & Bags',
  'Mature',
  'Media',
  'Office Supplies',
  'Religious & Ceremonial',
  'Software',
  'Sporting Goods',
  'Toys & Games',
  'Vehicles & Parts',
];

describe('SALS3_TAXONOMY_DEPARTMENTS', () => {
  it('is the taxonomy v1 department list, all 21, in order', () => {
    expect([...SALS3_TAXONOMY_DEPARTMENTS]).toEqual(DEPARTMENTS);
  });

  it('carries no supplier path fragments', () => {
    SALS3_TAXONOMY_DEPARTMENTS.forEach((department) => {
      expect(department).not.toMatch(/[>/]/);
    });
  });
});
