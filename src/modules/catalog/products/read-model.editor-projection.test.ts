// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

// `read-model.ts` is `server-only`, which throws on import outside a Server
// Component. The guard is doing its job; this test exercises a pure projection
// inside that module, so it stands the guard down rather than moving the
// function somewhere less protected.
vi.mock('server-only', () => ({}));

/* eslint-disable import/first */
import type { CatalogueProductFixture } from '@/lib/seller-center/product-catalogue/types';
import { productToEditorFixture } from './read-model';
/* eslint-enable import/first */

/**
 * What a draft imported from Product Sourcing actually shows the seller.
 *
 * The defect these cover was reported by the owner on 2026-08-14: a draft
 * created from a Ready candidate rendered no photo above Basic Information and
 * printed "Unmapped category" where CJ's own category name belonged. Both were
 * projection bugs rather than missing data — the address and the category name
 * were in the database the whole time.
 *
 * `productToEditorFixture` is pure, so these assert the projection itself
 * instead of a screen that happens to render it.
 */

const CATALOGUE_PRODUCT: CatalogueProductFixture = {
  id: '90a329b9-56aa-4f54-abb2-ad843602aa73',
  sals3ProductId: '90a329b9-56aa-4f54-abb2-ad843602aa73',
  name: 'Mens Short-Style Cold-Weather Waterproof Shell Jacket',
  descriptionText: '',
  hasImage: true,
  coverImageUrl:
    'https://cf.cjdropshipping.com/quick/product/697a2372-330c-4a72-8837-6ca100d99fab.jpg',
  mediaImageUrls: [
    'https://cf.cjdropshipping.com/quick/product/697a2372-330c-4a72-8837-6ca100d99fab.jpg',
    'https://cf.cjdropshipping.com/quick/product/a7657750-4318-47e8-875f-b6220ac35354.jpg',
  ],
  status: 'DRAFT',
  categoryPath: 'Unmapped category',
  categoryCode: null,
  sals3CategoryL1: null,
  supplierCategoryPath: "Men's Jackets",
  supplierCategoryId: '2409230540351618000',
  supplierSku: 'CJPK2718027',
  supplierWeightLabel: '1180.00-1300.00 g',
  supplierFromPrice: { amountMinor: 1526, currency: 'USD' },
  supplierShipsFrom: ['CN', 'CN_US'],
  supplierListedCount: 17,
  createdAt: '2026-08-13T12:41:39.393Z',
  supplierProviderCode: 'CJ_DROPSHIPPING',
  supplierProviderName: 'CJdropshipping',
  sourceCandidateId: 'd42f28bc-5744-4b09-86ac-45c6de8774a9',
  supplierConnectionHealth: 'CONNECTED',
  cjProductId: '2601080502051612800',
  sellingPrice: null,
  availability: 'UNKNOWN_OR_STALE',
  stockEvidence: 'UNKNOWN_STOCK',
  supplierObservedQuantity: null,
  lastCheckedAt: '2026-08-13T12:41:39.393Z',
  evidenceFreshness: 'UNKNOWN',
  mediaStatus: 'OWN_PICTURES',
  contentReadiness: 'NEEDS_IMPROVEMENT',
  pauseReason: null,
  storefrontUrl: null,
  attentionReasons: [],
  editorFixtureKey: 'pass',
  currentRevisionId: '22222222-2222-4222-8222-222222222222',
  currentRevisionVersion: 3,
  variants: [],
};

describe('productToEditorFixture — supplier media', () => {
  it('carries the recorded image address and alternative text onto the tile', () => {
    const { fixture } = productToEditorFixture(CATALOGUE_PRODUCT);

    expect(fixture.media).toHaveLength(2);
    expect(fixture.media[0].sourceUrl).toBe(CATALOGUE_PRODUCT.coverImageUrl);
    expect(fixture.media[1].sourceUrl).toContain('a7657750');
    expect(fixture.media[0].altText).toContain(CATALOGUE_PRODUCT.name);
    expect(fixture.media[0].isCover).toBe(true);
    expect(fixture.media[1].isCover).toBe(false);
  });

  it('claims no Sals3-held copy of the file, and no dimensions it never measured', () => {
    const { fixture } = productToEditorFixture(CATALOGUE_PRODUCT);

    expect(fixture.media[0].storageState).toBe('SUPPLIER_HOSTED_SOURCE');
    expect(fixture.media[0].pixelWidth).toBe(0);
    expect(fixture.media[0].pixelHeight).toBe(0);
  });

  it('reports an address with no provenance row as pending, not verified', () => {
    const { fixture } = productToEditorFixture({
      ...CATALOGUE_PRODUCT,
      mediaStatus: 'NEEDS_MEDIA_REVIEW',
    });

    expect(fixture.media[0].rightsCheck).toBe('PENDING_VERIFICATION');
  });

  it('shows no tile at all when no address is recorded', () => {
    const { fixture } = productToEditorFixture({
      ...CATALOGUE_PRODUCT,
      hasImage: false,
      coverImageUrl: null,
      mediaImageUrls: [],
    });

    expect(fixture.media).toEqual([]);
  });
});

describe('productToEditorFixture — the CJ category is the category', () => {
  it('shows the CJ category as the category when no mapped row exists yet', () => {
    // Owner decision 2026-08-14: the CJ category IS the Sals3 category. A
    // row not yet carrying a mapped category shows the supplier's own
    // category — exactly what publication will categorise it as.
    const { fixture } = productToEditorFixture(CATALOGUE_PRODUCT);

    expect(fixture.supplierCategoryPath).toBe("Men's Jackets");
    expect(fixture.sals3CategoryPath).toBe("Men's Jackets");
    expect(fixture.sals3CategoryL1).toBeNull();
    expect(fixture.categoryMappingConfidence).toBe('ACCEPTABLE');
  });

  it('uses the saved Sals3 L1 draft category when one exists', () => {
    const { fixture } = productToEditorFixture({
      ...CATALOGUE_PRODUCT,
      sals3CategoryL1: 'Apparel & Accessories',
    });

    expect(fixture.sals3CategoryL1).toBe('Apparel & Accessories');
  });

  it('does not default the seller draft L1 from the mapped or supplier category', () => {
    const { fixture } = productToEditorFixture({
      ...CATALOGUE_PRODUCT,
      categoryPath: 'Home & Garden > Storage',
      supplierCategoryPath: 'Home & Garden > Storage',
      sals3CategoryL1: null,
    });

    expect(fixture.sals3CategoryPath).toBe('Home & Garden > Storage');
    expect(fixture.sals3CategoryL1).toBeNull();
  });

  it('exposes the open draft revision token for database saves', () => {
    const { fixture } = productToEditorFixture(CATALOGUE_PRODUCT);

    expect(fixture.draftSaveTarget).toEqual({
      productId: CATALOGUE_PRODUCT.id,
      revisionId: '22222222-2222-4222-8222-222222222222',
      expectedRevisionVersion: 3,
    });
  });

  it('stays honestly unmapped only when no CJ category exists anywhere', () => {
    const { fixture } = productToEditorFixture({
      ...CATALOGUE_PRODUCT,
      supplierCategoryPath: null,
    });

    expect(fixture.supplierCategoryPath).toBe('Not recorded');
    expect(fixture.sals3CategoryPath).toBe('Unmapped category');
    expect(fixture.sals3CategoryL1).toBeNull();
    expect(fixture.categoryMappingConfidence).toBe('UNMAPPED');
  });

  it('raises the category blocker only when there is no CJ category at all', () => {
    const blocked = productToEditorFixture({
      ...CATALOGUE_PRODUCT,
      supplierCategoryPath: null,
    });
    const publishable = productToEditorFixture(CATALOGUE_PRODUCT);

    expect(
      blocked.fixture.issues.some((issue) =>
        issue.title.includes('CJ category is missing'),
      ),
    ).toBe(true);
    expect(
      publishable.fixture.issues.some((issue) =>
        issue.title.toLowerCase().includes('category'),
      ),
    ).toBe(false);
  });

  it('marks the CJ-provided category as supplier-sourced, filled and required', () => {
    const { fixture } = productToEditorFixture(CATALOGUE_PRODUCT);
    const category = fixture.specifications.find(
      (specification) => specification.key === 'category',
    );

    expect(category).toMatchObject({
      label: 'CJ Category',
      value: "Men's Jackets",
      requirement: 'REQUIRED',
      source: 'SUPPLIER',
      unresolved: false,
    });
  });

  it('never attributes a missing category to the seller', () => {
    const { fixture } = productToEditorFixture({
      ...CATALOGUE_PRODUCT,
      supplierCategoryPath: null,
    });
    const category = fixture.specifications.find(
      (specification) => specification.key === 'category',
    );

    expect(category).toMatchObject({
      requirement: 'REQUIRED',
      source: 'NOT_PROVIDED',
      unresolved: true,
    });
  });

  it('lists the supplier facts the import used to drop', () => {
    const { fixture } = productToEditorFixture(CATALOGUE_PRODUCT);
    const byKey = new Map(
      fixture.specifications.map((specification) => [
        specification.key,
        specification,
      ]),
    );

    // `sals3_category` is deliberately absent: with no reviewed mapping yet,
    // the curated category is the auto-mirror's copy of the supplier's own
    // text, which would just repeat the CJ Category field verbatim.
    expect(byKey.has('sals3_category')).toBe(false);
    expect(byKey.get('supplier_sku')?.value).toBe('CJPK2718027');
    expect(byKey.get('packed_weight')?.value).toBe('1180.00-1300.00 g');
    expect(byKey.get('ships_from')?.value).toBe('CN, CN_US');
    // Supplier evidence, so no unresolved-required blocker is invented from a
    // field the seller has no way to fill in.
    ['supplier_sku', 'packed_weight', 'ships_from'].forEach((key) => {
      expect(byKey.get(key)).toMatchObject({
        source: 'SUPPLIER',
        requirement: 'OPTIONAL',
        unresolved: false,
      });
    });
  });

  /**
   * The regression this session's constant-position-adjacent investigation
   * found: `effectiveCategoryPath` follows `products.categoryId`, which a
   * reviewed Sals3 v1 mapping (2026-08-15 reversal of the 2026-08-14 mirror
   * decision) now updates independently of CJ's own category. Before this
   * fix, "CJ Category" silently switched to showing the curated path the
   * moment a mapping diverged — exactly the field CJ order fulfillment
   * relies on staying untouched. It must keep showing raw supplier evidence
   * regardless of any mapping decision, and the curated category gets its
   * own separate, honestly-labelled entry instead.
   */
  it('keeps CJ Category as the supplier text even when a curated mapping diverges, and surfaces the curated category separately', () => {
    const { fixture } = productToEditorFixture({
      ...CATALOGUE_PRODUCT,
      categoryPath: 'Apparel & Accessories > Jackets',
      categoryCode: 'CAT-GGL-100230',
    });
    const byKey = new Map(
      fixture.specifications.map((specification) => [
        specification.key,
        specification,
      ]),
    );

    // The hard constraint: CJ Category never moves off the supplier's text.
    expect(byKey.get('category')).toMatchObject({
      label: 'CJ Category',
      value: "Men's Jackets",
      source: 'SUPPLIER',
    });
    // The curated category is visible too, honestly labelled as Sals3's own
    // decision rather than folded into the supplier's field.
    expect(byKey.get('sals3_category')).toMatchObject({
      label: 'Sals3 Category (curated)',
      value: 'Apparel & Accessories > Jackets',
      source: 'INFERRED',
      requirement: 'OPTIONAL',
      unresolved: false,
    });
  });

  it('omits a supplier attribute the row does not carry, rather than printing a blank', () => {
    const { fixture } = productToEditorFixture({
      ...CATALOGUE_PRODUCT,
      supplierSku: null,
      supplierWeightLabel: null,
      supplierShipsFrom: [],
    });
    const keys = fixture.specifications.map(
      (specification) => specification.key,
    );

    expect(keys).toEqual(['category']);
  });

  it('carries the supplier packed weight into the market evidence block', () => {
    const { fixture } = productToEditorFixture(CATALOGUE_PRODUCT);

    expect(fixture.markets[0].packageWeightLabel).toBe('1180.00-1300.00 g');
  });
});

/**
 * Owner decision 2026-08-15: category tagging is per-seller, not a shared
 * mapping. `categoryMappingConfidence` cannot say whether THIS product's own
 * seller ever decided anything — the CJ auto-mirror (`cj-mirror.ts`) already
 * resolves `EXACT`/`ACCEPTABLE` confidence for almost every CJ-sourced
 * product before any seller opens the picker. `categoryMappingId` is the
 * real signal: null means the seller's own direct decision
 * (`decideProductSals3Category` never creates a `provider_category_mappings`
 * row), non-null means the auto-mirror or a reviewed crosswalk rule produced
 * it.
 */
describe('productToEditorFixture — seller-declared vs. auto-derived category', () => {
  it('is false when no category exists at all', () => {
    const { fixture } = productToEditorFixture({
      ...CATALOGUE_PRODUCT,
      categoryCode: null,
      categoryMappingId: null,
    });

    expect(fixture.sals3CategoryDeclaredBySeller).toBe(false);
  });

  it('is false for the CJ auto-mirror or a reviewed crosswalk rule, even at EXACT confidence', () => {
    const { fixture } = productToEditorFixture({
      ...CATALOGUE_PRODUCT,
      categoryPath: "CJ's own mirrored category name",
      categoryCode: 'CJ-1042',
      categoryMappingId: 'mapping-row-1',
    });

    expect(fixture.categoryMappingConfidence).toBe('ACCEPTABLE');
    expect(fixture.sals3CategoryDeclaredBySeller).toBe(false);
  });

  it('is true only for a category with no mapping row behind it', () => {
    const { fixture } = productToEditorFixture({
      ...CATALOGUE_PRODUCT,
      categoryPath: 'Apparel & Accessories > Jackets',
      categoryCode: 'CAT-GGL-100230',
      categoryMappingId: null,
    });

    expect(fixture.sals3CategoryDeclaredBySeller).toBe(true);
  });
});
