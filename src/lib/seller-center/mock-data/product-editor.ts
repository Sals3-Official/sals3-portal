import {
  descriptionBlocksToPlainText,
  type DescriptionBlock,
} from '@/lib/products/description-blocks';
import type {
  MarketEvidenceFixture,
  MediaItemFixture,
  MoneyValue,
  ProductEditorFixture,
  ReadinessIssue,
  SpecificationFixture,
  SupplierSourceIdentity,
  VariantFixture,
} from '@/lib/seller-center/product-editor/types';

/**
 * Fictional product-draft fixtures for the Product Editor design preview.
 *
 * Every value here is invented. Nothing is read from or written to a
 * database, a supplier API, or the evaluation pipeline, and no fixture
 * corresponds to a real candidate. They exist so the eight required design
 * states can be opened directly by URL and asserted in tests, without
 * wiring fictional data behind a real "Customize & List" action.
 *
 * Same posture as the other files in this folder (`listings.ts`,
 * `orders.ts`, ...): illustrative placeholder data for interface review,
 * not a confirmed business rule. The markets are deliberately "Sample
 * market A / B" rather than countries, because no destination market has
 * been approved (ADR-003).
 */

const CURRENCY = 'USD';

function usd(amountMinor: number): MoneyValue {
  return { amountMinor, currency: CURRENCY };
}

const FRESH_CAPTURE = '2026-08-08T06:05:00.000Z';
const STALE_CAPTURE = '2026-08-03T02:11:00.000Z';

const SOURCE: SupplierSourceIdentity = {
  providerId: 'provider-cj',
  providerCode: 'cj-dropshipping',
  providerDisplayName: 'CJ Dropshipping',
  providerLogoPath: '/suppliers/cj-dropshipping-logo-white.svg',
  connectionId: 'connection-1',
  connectionDisplayName: 'Sals3 Official Dropshipper · connection #1',
  connectionStatus: 'CONNECTED',
  externalProductId: 'CJPD2291845007',
  sourceCurrency: CURRENCY,
  lastSuccessfulSyncAt: FRESH_CAPTURE,
  lastAttemptedSyncAt: FRESH_CAPTURE,
};

type VariantSeed = {
  id: string;
  optionLabel: string;
  costMinor: number;
  retailMinor: number;
  stock: number;
  hasImage?: boolean;
};

const VARIANT_SEEDS: VariantSeed[] = [
  {
    id: 'slt20',
    optionLabel: 'Slate / 20L',
    costMinor: 842,
    retailMinor: 2490,
    stock: 412,
  },
  {
    id: 'slt28',
    optionLabel: 'Slate / 28L',
    costMinor: 965,
    retailMinor: 2790,
    stock: 260,
  },
  {
    id: 'clay20',
    optionLabel: 'Clay / 20L',
    costMinor: 842,
    retailMinor: 2490,
    stock: 188,
  },
  {
    id: 'clay28',
    optionLabel: 'Clay / 28L',
    costMinor: 965,
    retailMinor: 2790,
    stock: 96,
  },
  {
    id: 'moss20',
    optionLabel: 'Moss / 20L',
    costMinor: 842,
    retailMinor: 2490,
    stock: 328,
    hasImage: false,
  },
  {
    id: 'moss28',
    optionLabel: 'Moss / 28L',
    costMinor: 965,
    retailMinor: 2790,
    stock: 0,
  },
];

function buildVariant(seed: VariantSeed): VariantFixture {
  const inStock = seed.stock > 0;

  return {
    id: seed.id,
    optionLabel: seed.optionLabel,
    sellerSku: `AUR-DP-${seed.id.toUpperCase()}`,
    supplierCost: usd(seed.costMinor),
    retailPrice: usd(seed.retailMinor),
    supplierStock: seed.stock,
    warehouseLabel: 'Not shown',
    hasImage: seed.hasImage ?? true,
    enabled: inStock,
    listingState: inStock ? 'WILL_LIST' : 'NOT_LISTED',
    attention: inStock ? null : 'Out of stock',
    supplierVariantId: `CJV${seed.id.toUpperCase()}0042`,
    packedWeightGrams: seed.optionLabel.endsWith('28L') ? 520 : 410,
    evidenceCapturedAt: FRESH_CAPTURE,
  };
}

const BASE_VARIANTS: VariantFixture[] = VARIANT_SEEDS.map(buildVariant);

const BASE_MARKETS: MarketEvidenceFixture[] = [
  {
    code: 'A',
    name: 'Sample market A',
    isSampleMarket: true,
    eligibility: 'ELIGIBLE',
    affectedVariantsLabel: '6 of 6 variants',
    packageWeightLabel: '410 g – 520 g',
    evidenceCapturedAt: FRESH_CAPTURE,
    note: null,
  },
  {
    code: 'B',
    name: 'Sample market B',
    isSampleMarket: true,
    eligibility: 'ELIGIBLE',
    affectedVariantsLabel: '6 of 6 variants',
    packageWeightLabel: '410 g – 520 g',
    evidenceCapturedAt: FRESH_CAPTURE,
    note: null,
  },
];

/**
 * `sourceUrl: null` on every tile, deliberately.
 *
 * These fixtures describe a fictional product. Pointing one at a real CJ image
 * address would show a real supplier's photograph under an invented listing,
 * and the tiles exist here to demonstrate the rights/storage label families,
 * not the imagery. The editor renders a labelled placeholder for a tile with no
 * address, which is what these previews have always shown.
 */
const BASE_MEDIA: MediaItemFixture[] = [
  {
    id: 'm1',
    label: 'Cover image',
    sourceUrl: null,
    altText: 'Cover image placeholder',
    rightsCheck: 'VERIFIED',
    storageState: 'SUPPLIER_HOSTED_SOURCE',
    sourceType: 'SUPPLIER_ORIGINAL',
    pixelWidth: 1200,
    pixelHeight: 1200,
    note: null,
    isCover: true,
  },
  {
    id: 'm2',
    label: 'Image 2',
    sourceUrl: null,
    altText: 'Image 2 placeholder',
    rightsCheck: 'VERIFIED',
    storageState: 'SUPPLIER_HOSTED_SOURCE',
    sourceType: 'SUPPLIER_ORIGINAL',
    pixelWidth: 1200,
    pixelHeight: 1200,
    note: null,
    isCover: false,
  },
  {
    id: 'm3',
    label: 'Image 3',
    sourceUrl: null,
    altText: 'Image 3 placeholder',
    rightsCheck: 'VERIFIED',
    storageState: 'SUPPLIER_HOSTED_SOURCE',
    sourceType: 'SUPPLIER_ORIGINAL',
    pixelWidth: 1000,
    pixelHeight: 1000,
    note: null,
    isCover: false,
  },
  {
    id: 'm4',
    label: 'Image 4',
    sourceUrl: null,
    altText: 'Image 4 placeholder',
    rightsCheck: 'VERIFIED',
    storageState: 'SUPPLIER_HOSTED_SOURCE',
    sourceType: 'SUPPLIER_ORIGINAL',
    pixelWidth: 900,
    pixelHeight: 900,
    note: null,
    isCover: false,
  },
  {
    id: 'm5',
    label: 'Image 5',
    sourceUrl: null,
    altText: 'Image 5 placeholder',
    rightsCheck: 'PENDING_VERIFICATION',
    storageState: 'PENDING_IMPORT',
    sourceType: 'SUPPLIER_ORIGINAL',
    pixelWidth: 640,
    pixelHeight: 640,
    note: 'Below the 800 px recommendation. Storage status unavailable.',
    isCover: false,
  },
];

const BASE_SPECIFICATIONS: SpecificationFixture[] = [
  {
    key: 'material',
    label: 'Material',
    value: 'Recycled polyester 210D',
    requirement: 'REQUIRED',
    source: 'SUPPLIER',
    unresolved: false,
  },
  {
    key: 'capacity',
    label: 'Capacity',
    value: '20 L / 28 L',
    requirement: 'REQUIRED',
    source: 'SUPPLIER',
    unresolved: false,
  },
  {
    key: 'closure-type',
    label: 'Closure type',
    value: 'Zipper',
    requirement: 'REQUIRED',
    source: 'INFERRED',
    unresolved: false,
  },
  {
    key: 'water-resistance',
    label: 'Water resistance',
    value: 'Water-repellent finish',
    requirement: 'RECOMMENDED',
    source: 'SUPPLIER',
    unresolved: false,
  },
  {
    key: 'care-instructions',
    label: 'Care instructions',
    value: '',
    requirement: 'OPTIONAL',
    source: 'NOT_PROVIDED',
    unresolved: true,
  },
  {
    key: 'warranty',
    label: 'Warranty',
    value: '',
    requirement: 'OPTIONAL',
    source: 'NOT_PROVIDED',
    unresolved: true,
  },
];

/**
 * Real blocks rather than a string imitating them with bullet characters and
 * bare lines standing in for headings. The document format has carried
 * headings and lists since it was written; only the editor could not produce
 * them, and a fixture faking the shape in prose kept hiding that.
 */
const DESCRIPTION_BLOCKS: DescriptionBlock[] = [
  {
    type: 'paragraph',
    text: 'A packable 20L daypack for day hikes and commuting. Folds into its own pocket.',
  },
  { type: 'heading', level: 3, text: 'Key features' },
  {
    type: 'bulletList',
    items: [
      '210D recycled polyester shell, water-repellent finish',
      'Padded laptop sleeve fits most 14" machines',
      'Two stretch side pockets',
    ],
  },
  { type: 'heading', level: 3, text: 'Package contents' },
  {
    type: 'keyValueList',
    entries: [
      { label: 'Daypack', value: '1' },
      { label: 'Storage pouch', value: '1' },
    ],
  },
];

const DESCRIPTION = descriptionBlocksToPlainText(DESCRIPTION_BLOCKS);

const SUGGESTION_OPTIONAL_ATTRIBUTES: ReadinessIssue = {
  id: 'suggestion-optional-attributes',
  severity: 'SUGGESTION',
  title: 'Two optional attributes are empty',
  explanation:
    'Care instructions and Warranty are not required to publish, and the supplier did not provide them.',
  affectedScope: 'Category & Specifications',
  source: 'AUTOMATED_VALIDATION',
  section: 'specs',
  reasonCode: null,
  resolution: 'Optional - enter them yourself if you have the information.',
};

const SUGGESTION_SUPPLIER_COPY: ReadinessIssue = {
  id: 'suggestion-supplier-copy',
  severity: 'SUGGESTION',
  title: 'Description reuses supplier copy unchanged',
  explanation:
    'Rewriting the summary and feature list usually improves the storefront listing. Optional.',
  affectedScope: 'Description',
  source: 'SUGGESTION',
  section: 'description',
  reasonCode: null,
  resolution: 'Optional - rewrite the description in your own words.',
};

/**
 * Seller-facing wording for the accepted-order guarantee. Deliberately
 * plain: the internal term for the record this describes
 * (`OrderLineSnapshot`, ADR-007) is engineering vocabulary and stays in
 * the code, not on a seller's screen.
 */
const ACCEPTED_ORDER_IMPACT =
  'Accepted orders are unaffected. Each one keeps the product, variant, price basis, image and supplier evidence it was accepted with, and stays active unless it is cancelled through the order workflow.';

const BASE: ProductEditorFixture = {
  fixtureKey: 'pass',
  scenarioLabel: 'PASS - ready to publish',
  productName: 'Aurelis 20L Packable Daypack',
  supplierProductName:
    'Aurelis Outdoor 20L 28L Foldable Lightweight Travel Daypack Backpack for Hiking Camping',
  supplierCategoryPath: 'Luggage & Bags > Backpacks > Casual Daypacks',
  sals3CategoryPath: 'Luggage & Bags > Backpacks',
  // The gap this fixture used to document is closed. Taxonomy v0 had no
  // unisex/outdoor backpack branch — only gendered "Bags" departments carried
  // one — so it sat at `CAT-MEN-100564` with `ACCEPTABLE` confidence because a
  // unisex daypack does not belong under "Men's Bags". Taxonomy v1 has
  // `Luggage & Bags > Backpacks`, ungendered, so the match is now exact.
  //
  // `sals3CategoryL1` is typed `string | null`, so the retired v0 department
  // stayed here through the swap: it type-checked, passed 1,574 tests, and was
  // only visible on opening the picker in a browser.
  sals3CategoryCode: 'CAT-GGL-100',
  sals3CategoryL1: 'Luggage & Bags',
  categoryMappingConfidence: 'EXACT',
  // A design-preview fixture, not a database row - there is no auto-mirror
  // vs. seller-declared distinction to fake here, so this is simply "a real
  // category is already on record" to match the scenario's PASS/ready state.
  sals3CategoryDeclaredBySeller: true,
  realSupplierCandidateId: null,
  sellerSku: 'S3-AUR-DP',
  brandDeclaration: 'No brand / generic',
  descriptionBlocks: DESCRIPTION_BLOCKS,
  // Unmapped in every design-preview fixture: no real option rows exist to
  // rename, so the section shows its mapping form rather than a summary.
  mappedAxes: [],
  descriptionText: DESCRIPTION,
  // Nothing persists in a design-preview fixture (no `saveMetaDescriptionAction`
  // target either), so this starts unset the same way a real never-saved
  // product would - the editor's own suggestion seam fills the textarea on
  // screen, never this fixture.
  metaDescriptionText: '',
  source: SOURCE,
  evaluationStatus: 'PASS',
  listingState: 'DRAFT',
  completionPercent: 92,
  lastValidatedAt: FRESH_CAPTURE,
  sourceProductStatus: 'LISTED_BY_SUPPLIER',
  banner: null,
  issues: [SUGGESTION_OPTIONAL_ATTRIBUTES, SUGGESTION_SUPPLIER_COPY],
  sourceChanges: [],
  // These fixtures have no supplier snapshot behind them, so there is nothing
  // to compare against — a different state from "nothing changed", and the
  // panel says which one it is.
  sourceChangesCapturedAt: null,
  // These design-preview variants carry Sals3-authored labels rather than a
  // supplier's concatenated string, so there is nothing to derive a split from.
  // An empty proposal is the honest state: the section says so rather than
  // offering axes this fixture never received.
  optionMapping: {
    proposal: [],
    mappedAxisNames: [],
    suggestedAxisNames: [],
    // No proposal on the illustrative fixtures, so nothing is gated on one.
    mappingBlocksPublish: false,
    variantCount: BASE_VARIANTS.length,
    // Zero, not the variant count: these fixtures have no supplier evidence
    // behind them, so nothing could be recovered and the section must not offer
    // a button that would find nothing.
    unlabelledVariantCount: 0,
  },
  specifications: BASE_SPECIFICATIONS,
  // Design-preview fixtures carry no real category-attribute extraction -
  // empty is the honest "nothing to render" state, same posture as every
  // other design-only field in this file.
  categoryAttributes: [],
  categoryAttributesControlsVersion: null,
  variants: BASE_VARIANTS,
  markets: BASE_MARKETS,
  marketsNotEnabledCount: 1,
  // No fixture claims a seller-upload capability that does not exist yet
  // (ADR-011): every illustrative photo here is the supplier's, so `media`
  // (seller uploads) stays empty and `BASE_MEDIA` becomes `supplierMedia`.
  media: [],
  supplierMedia: BASE_MEDIA,
  showSupplierPhoto: true,
  policyVersion: '2026.08.01',
  draftSaveTarget: null,
  publishTarget: null,
  advancedIdentifiers: {
    draft_id: '8f2c1a7e-6f0b-4a1d-9d3e-77e2c0b41a55',
    supplier_connection_id: '3c9d2f14-2a71-4b09-bb52-1e8a4d770a12',
    external_product_id: SOURCE.externalProductId,
    evidence_snapshot_id: '5b1f9c33-77aa-40b4-8f2f-0dbe5f9c1a09',
    policy_version: '2026.08.01',
  },
};

function withOverrides(
  overrides: Partial<ProductEditorFixture>,
): ProductEditorFixture {
  return { ...BASE, ...overrides };
}

/* ---------------------------------------------------------------- PASS_WITH_ATTENTION */

const ATTENTION_VARIANTS: VariantFixture[] = BASE_VARIANTS.map((variant) =>
  variant.optionLabel.endsWith('28L')
    ? { ...variant, retailPrice: usd(1990) }
    : variant,
);

const ATTENTION_SPECIFICATIONS: SpecificationFixture[] =
  BASE_SPECIFICATIONS.map((spec) =>
    spec.key === 'water-resistance'
      ? { ...spec, value: '', source: 'NOT_PROVIDED', unresolved: true }
      : spec,
  );

const ATTENTION_MEDIA: MediaItemFixture[] = BASE_MEDIA.map((item) =>
  item.id === 'm5'
    ? {
        ...item,
        rightsCheck: 'REJECTED',
        note: 'Visible third-party watermark. This image will not be published; replace it or remove it.',
      }
    : item,
);

const ATTENTION = withOverrides({
  fixtureKey: 'attention',
  scenarioLabel: 'PASS_WITH_ATTENTION - publishable with warnings',
  evaluationStatus: 'PASS_WITH_ATTENTION',
  completionPercent: 78,
  variants: ATTENTION_VARIANTS,
  specifications: ATTENTION_SPECIFICATIONS,
  supplierMedia: ATTENTION_MEDIA,
  issues: [
    {
      id: 'warning-watermarked-image',
      severity: 'WARNING',
      title: 'One image carries a visible watermark',
      explanation:
        'Image 5 shows third-party branding. It will be withheld from the storefront until it is replaced.',
      affectedScope: 'Supplier Details · Image 5',
      source: 'AUTOMATED_VALIDATION',
      section: 'specs',
      reasonCode: null,
      resolution: 'Replace or remove the image.',
    },
    {
      id: 'warning-recommended-specification',
      severity: 'WARNING',
      title: 'A recommended specification is missing',
      explanation:
        'Water resistance has no supplier value and no seller value. Publishing continues, and the attribute stays empty on the storefront until you fill it in.',
      affectedScope: 'Category & Specifications · Water resistance',
      source: 'AUTOMATED_VALIDATION',
      section: 'specs',
      reasonCode: null,
      resolution: 'Enter a value, or publish without it.',
    },
    SUGGESTION_SUPPLIER_COPY,
  ],
});

/* ---------------------------------------------------------------- BLOCKED */

const BLOCKED_SPECIFICATIONS: SpecificationFixture[] = [
  ...BASE_SPECIFICATIONS,
  {
    key: 'country-of-origin',
    label: 'Country of origin',
    value: '',
    requirement: 'REQUIRED',
    source: 'NOT_PROVIDED',
    unresolved: true,
  },
];

const BLOCKED = withOverrides({
  fixtureKey: 'blocked',
  scenarioLabel: 'BLOCKED - publishing disabled',
  productName: 'Aurelis "N-Tech" Pro Daypack',
  evaluationStatus: 'BLOCKED',
  completionPercent: 61,
  descriptionBlocks: [],
  descriptionText: '',
  specifications: BLOCKED_SPECIFICATIONS,
  banner: {
    tone: 'danger',
    title: 'Publishing is disabled for this product',
    body: 'Three hard blockers apply. Blocked candidates have no override for the permanent one - it is a policy match, not a seller judgment call.',
  },
  variants: BASE_VARIANTS.map((variant) => ({
    ...variant,
    enabled: false,
    listingState: 'BLOCKED',
    attention: 'Blocked',
  })),
  markets: BASE_MARKETS.map((market) => ({
    ...market,
    eligibility: 'BLOCKED',
    note: 'This market is blocked by supplier or policy evidence. Nothing on this screen can resolve it.',
  })),
  issues: [
    {
      id: 'blocker-counterfeit',
      severity: 'BLOCKER',
      title: 'Suspected counterfeit or unauthorised brand use',
      explanation:
        'The product name matches a protected brand with no authorisation evidence on file. Permanent block - no override.',
      affectedScope: 'Basic Information · Product Name',
      source: 'AUTOMATED_VALIDATION',
      section: 'basic',
      reasonCode: 'COUNTERFEIT_HIGH_CONFIDENCE',
      resolution: 'No resolution path.',
    },
    {
      id: 'blocker-no-route',
      severity: 'BLOCKER',
      title: 'No eligible enabled market',
      explanation:
        'Every enabled market is blocked, so no variant can be offered.',
      affectedScope: 'Markets · Sample market A, Sample market B',
      source: 'AUTOMATED_VALIDATION',
      section: 'markets',
      reasonCode: 'NO_SHIPPING_ROUTE',
      resolution: 'Retryable - the pipeline rechecks this on its own.',
    },
    {
      id: 'blocker-missing-required-specification',
      severity: 'BLOCKER',
      title: 'A required specification is missing',
      explanation:
        'Country of origin has no supplier value and no seller value. Publication requires it, so this is a blocker rather than a warning.',
      affectedScope: 'Category & Specifications · Country of origin',
      source: 'AUTOMATED_VALIDATION',
      section: 'specs',
      reasonCode: 'INSUFFICIENT_PRODUCT_DATA',
      resolution: 'Enter a value to clear this blocker.',
    },
  ],
});

/* ---------------------------------------------------------------- mixed variant stock */

const MIXED_STOCK = withOverrides({
  fixtureKey: 'mixed-stock',
  scenarioLabel: 'Mixed variant stock - 3 of 6 variants unavailable',
  evaluationStatus: 'PASS_WITH_ATTENTION',
  completionPercent: 80,
  variants: BASE_VARIANTS.map((variant, index) =>
    index > 2
      ? {
          ...variant,
          supplierStock: 0,
          enabled: false,
          listingState: 'NOT_LISTED',
          attention: 'Out of stock',
        }
      : variant,
  ),
  issues: [
    {
      id: 'warning-mixed-stock',
      severity: 'WARNING',
      title: '3 of 6 variants have no supplier stock',
      explanation:
        'Clay / 28L, Moss / 20L and Moss / 28L report zero stock across every warehouse. They are switched off and will not appear on the storefront.',
      affectedScope: 'Variants & Pricing · 3 variants',
      source: 'AUTOMATED_VALIDATION',
      section: 'variants',
      reasonCode: null,
      resolution: 'Auto-resolved when the supplier restocks.',
    },
    SUGGESTION_OPTIONAL_ATTRIBUTES,
  ],
});

/* ---------------------------------------------------------------- market attention */

const MARKET_ROUTE = withOverrides({
  fixtureKey: 'market-route',
  scenarioLabel: 'Market attention - still publishes elsewhere',
  evaluationStatus: 'PASS_WITH_ATTENTION',
  completionPercent: 84,
  markets: BASE_MARKETS.map((market) =>
    market.code === 'B'
      ? {
          ...market,
          eligibility: 'NO_ROUTE',
          affectedVariantsLabel: '0 of 6 variants',
          note: 'The listing can still publish to Sample market A. Sample market B is withheld until its evidence is eligible again.',
        }
      : market,
  ),
  issues: [
    {
      id: 'warning-market-b-no-route',
      severity: 'WARNING',
      title: 'Sample market B is not eligible',
      explanation:
        'The product stays publishable to Sample market A. Sample market B will not be offered while eligibility evidence is unresolved.',
      affectedScope: 'Markets · Sample market B',
      source: 'AUTOMATED_VALIDATION',
      section: 'markets',
      reasonCode: 'NO_SHIPPING_ROUTE',
      resolution: 'Retryable - rechecked on every pipeline tick.',
    },
  ],
});

/* ---------------------------------------------------------------- supplier price spike */

const PRICE_SPIKE = withOverrides({
  fixtureKey: 'price-spike',
  scenarioLabel: 'Supplier price spike - cost up 34%',
  evaluationStatus: 'PASS_WITH_ATTENTION',
  completionPercent: 82,
  variants: BASE_VARIANTS.map((variant) => ({
    ...variant,
    supplierCost: usd(Math.round(variant.supplierCost.amountMinor * 1.34)),
    attention: 'Cost +34%',
  })),
  issues: [
    {
      id: 'warning-price-spike',
      severity: 'WARNING',
      title: 'Supplier cost rose 34% since the last evaluation',
      explanation:
        'Retail prices were not changed automatically - review the margin before you publish.',
      affectedScope: 'Variants & Pricing · all variants',
      source: 'AUTOMATED_VALIDATION',
      section: 'variants',
      reasonCode: 'ABNORMAL_PRICE_CHANGE',
      resolution: 'Adjust retail prices, or publish at the current margin.',
    },
  ],
  sourceChanges: [
    {
      id: 'change-price-spike',
      title: 'Supplier raised cost on every variant',
      body: 'Supplier cost rose from $8.42 – $9.65 to $11.28 – $12.93 across all six variants.',
      occurredAt: FRESH_CAPTURE,
      currentListingImpact:
        'Current listing: retail prices are untouched, so the estimated margin dropped. Nothing was paused.',
      acceptedOrderImpact: ACCEPTED_ORDER_IMPACT,
      listingAutoPaused: false,
      sellerActionRequired: true,
    },
  ],
});

/* ---------------------------------------------------------------- supplier delisted */

const DELISTED = withOverrides({
  fixtureKey: 'delisted',
  scenarioLabel: 'Supplier delisted - published listing auto-paused',
  evaluationStatus: 'BLOCKED',
  listingState: 'PUBLISHED_PAUSED',
  completionPercent: 88,
  sourceProductStatus: 'DELISTED_BY_SUPPLIER',
  banner: {
    tone: 'danger',
    title: 'This listing was paused automatically',
    body: 'The supplier delisted the source product, so hard eligibility fails. Accepted orders are not affected - see Source Changes.',
  },
  variants: BASE_VARIANTS.map((variant) => ({
    ...variant,
    supplierStock: 0,
    enabled: false,
    listingState: 'PAUSED',
    attention: 'Source delisted',
  })),
  issues: [
    {
      id: 'blocker-source-delisted',
      severity: 'BLOCKER',
      title: 'Supplier delisted the source product',
      explanation:
        'The supplier no longer lists this product, so stock and eligibility evidence cannot be refreshed.',
      affectedScope: 'Whole listing',
      source: 'SUPPLIER_CHANGE',
      section: 'markets',
      reasonCode: 'NO_STOCK',
      resolution: 'No resolution path while the source stays delisted.',
    },
  ],
  sourceChanges: [
    {
      id: 'change-delisted',
      title: 'Supplier delisted the source product',
      body: 'The source product is no longer listed by the supplier, and no further evidence can be captured for it.',
      occurredAt: FRESH_CAPTURE,
      currentListingImpact:
        'Current listing: paused automatically. It stays off the storefront until the source returns or you delist it yourself.',
      acceptedOrderImpact: ACCEPTED_ORDER_IMPACT,
      listingAutoPaused: true,
      sellerActionRequired: true,
    },
  ],
});

/* ---------------------------------------------------------------- stale market evidence */

const STALE_EVIDENCE = withOverrides({
  fixtureKey: 'stale-evidence',
  scenarioLabel: 'Stale market evidence - degraded connection',
  evaluationStatus: 'PASS_WITH_ATTENTION',
  completionPercent: 86,
  lastValidatedAt: STALE_CAPTURE,
  source: {
    ...SOURCE,
    connectionStatus: 'DEGRADED',
    lastSuccessfulSyncAt: STALE_CAPTURE,
    lastAttemptedSyncAt: FRESH_CAPTURE,
  },
  banner: {
    tone: 'warning',
    title: 'Supplier evidence is 5 days old',
    body: 'The last three refresh attempts failed. Stock and market eligibility below are shown with their capture time rather than hidden.',
  },
  variants: BASE_VARIANTS.map((variant) => ({
    ...variant,
    evidenceCapturedAt: STALE_CAPTURE,
  })),
  markets: BASE_MARKETS.map((market) => ({
    ...market,
    eligibility: 'ELIGIBLE_STALE_EVIDENCE',
    evidenceCapturedAt: STALE_CAPTURE,
    note: 'Market evidence is 5 days old. It is shown as-is rather than hidden, and checked again before publication.',
  })),
  issues: [
    {
      id: 'warning-stale-evidence',
      severity: 'WARNING',
      title: 'Market evidence is 5 days old',
      explanation:
        'The last three refresh attempts could not reach the supplier. Evidence on this screen may be stale.',
      affectedScope: 'Markets · all markets',
      source: 'AUTOMATED_VALIDATION',
      section: 'markets',
      reasonCode: null,
      resolution: 'Retries automatically.',
    },
  ],
});

const FIXTURES: Record<string, ProductEditorFixture> = {
  pass: BASE,
  attention: ATTENTION,
  blocked: BLOCKED,
  'mixed-stock': MIXED_STOCK,
  'market-route': MARKET_ROUTE,
  'price-spike': PRICE_SPIKE,
  delisted: DELISTED,
  'stale-evidence': STALE_EVIDENCE,
};

/** The `?fixture=` allow list. Anything else is a 404, never a default. */
export const PRODUCT_EDITOR_FIXTURE_KEYS = Object.keys(FIXTURES);

/**
 * Allow-list lookup. Returns `null` for an unknown key - including a real
 * database candidate id - so the route can call `notFound()` rather than
 * quietly rendering fictional data under a real identifier.
 */
export function resolveProductEditorFixture(
  key: string | undefined,
): ProductEditorFixture | null {
  if (key === undefined) return null;

  // `Object.hasOwn`, not `FIXTURES[key]`: a plain object lookup happily
  // returns inherited members, so `?fixture=constructor` would resolve to
  // something that is not a fixture at all.
  if (!Object.hasOwn(FIXTURES, key)) return null;

  return FIXTURES[key];
}
