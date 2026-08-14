import type {
  AttentionReasonFixture,
  CatalogueProductFixture,
  CatalogueVariantFixture,
} from '@/lib/seller-center/product-catalogue/types';
import type { MoneyValue } from '@/lib/seller-center/product-editor/types';

/**
 * Fictional catalogue-list fixtures for the Product Catalogue design
 * preview. See `product-catalogue/types.ts` for the approved lifecycle/
 * availability/media contract these follow. Every row here represents a
 * Sals3 listing that has already passed through sourcing/customization -
 * this is never a mirror of `All Supplier Products` or the CJ evaluation
 * queue.
 *
 * `editorFixtureKey` links each fictional row to one of the 8 *real*
 * fixtures already built for the Product Editor
 * (`product-editor/mock-data.ts`'s `PRODUCT_EDITOR_FIXTURE_KEYS`), so
 * "Edit" opens the same screen this repo already has rather than a second,
 * parallel one.
 *
 * The set below deliberately covers every representative dropshipping
 * state the handoff asked for: fully available, needs-attention with a
 * non-blocking issue, one unavailable variant among purchasable siblings,
 * all-variants-unavailable auto-pause, supplier disconnect, stale/unknown
 * evidence, supplier-fallback media, needs-review/no-usable media, a
 * material supplier-cost change under review, and an archived listing.
 */

const CURRENCY = 'USD';
const SUPPLIER_PROVIDER_CODE = 'cj-dropshipping';
const SUPPLIER_PROVIDER_NAME = 'CJ Dropshipping';

function usd(amountMinor: number): MoneyValue {
  return { amountMinor, currency: CURRENCY };
}

function attention(
  overrides: Partial<AttentionReasonFixture> & { id: string },
): AttentionReasonFixture {
  return {
    severity: 'MEDIUM',
    reasonCode: 'UNSPECIFIED',
    summary: '',
    checkoutAllowed: true,
    ...overrides,
  };
}

type VariantSeed = Omit<
  CatalogueVariantFixture,
  'sellingPrice' | 'supplierCost' | 'supplierOptionLabel'
> & {
  sellingPriceMinor: number;
  supplierCostMinor: number;
};

function variant(seed: VariantSeed): CatalogueVariantFixture {
  return {
    id: seed.id,
    optionLabel: seed.optionLabel,
    // These design-preview products have no provider_variant_references row,
    // so there is no supplier label to report. `optionLabel` above is a
    // Sals3-authored display string, not something a supplier sent.
    supplierOptionLabel: null,
    sals3VariantId: seed.sals3VariantId,
    sellerSku: seed.sellerSku,
    cjVariantId: seed.cjVariantId,
    hasImage: seed.hasImage,
    sellingPrice: usd(seed.sellingPriceMinor),
    supplierCost: usd(seed.supplierCostMinor),
    availability: seed.availability,
    stockEvidence: seed.stockEvidence,
    supplierObservedQuantity: seed.supplierObservedQuantity,
    lastCheckedAt: seed.lastCheckedAt,
    evidenceFreshness: seed.evidenceFreshness,
    manuallyPaused: seed.manuallyPaused,
  };
}

const DAYPACK_VARIANTS: CatalogueVariantFixture[] = [
  variant({
    id: 'dp-slate-20',
    optionLabel: 'Color: Slate, Capacity: 20L',
    sals3VariantId: 'SALS3-V-1002-A',
    sellerSku: 'S3-AUR-DP-SLT20',
    cjVariantId: 'CJVID-2291845007-1',
    hasImage: true,
    sellingPriceMinor: 2490,
    supplierCostMinor: 1180,
    availability: 'AVAILABLE',
    stockEvidence: 'CJ_WAREHOUSE_STOCK',
    supplierObservedQuantity: 412,
    lastCheckedAt: '2026-08-10T06:00:00.000Z',
    evidenceFreshness: 'FRESH',
    manuallyPaused: false,
  }),
  variant({
    id: 'dp-clay-20',
    optionLabel: 'Color: Clay, Capacity: 20L',
    sals3VariantId: 'SALS3-V-1002-B',
    sellerSku: 'S3-AUR-DP-CLAY20',
    cjVariantId: 'CJVID-2291845007-2',
    hasImage: true,
    sellingPriceMinor: 2490,
    supplierCostMinor: 1180,
    availability: 'OUT_OF_STOCK',
    stockEvidence: 'ZERO_STOCK',
    supplierObservedQuantity: 0,
    lastCheckedAt: '2026-08-10T06:00:00.000Z',
    evidenceFreshness: 'FRESH',
    manuallyPaused: false,
  }),
];

const WATER_BOTTLE_VARIANTS: CatalogueVariantFixture[] = [
  variant({
    id: 'wb-blue-750',
    optionLabel: 'Color: Blue, Size: 750ml',
    sals3VariantId: 'SALS3-V-1004-A',
    sellerSku: 'S3-WB-BLUE-750',
    cjVariantId: 'CJVID-17309882010001-1',
    hasImage: true,
    sellingPriceMinor: 799,
    supplierCostMinor: 340,
    availability: 'OUT_OF_STOCK',
    stockEvidence: 'ZERO_STOCK',
    supplierObservedQuantity: 0,
    lastCheckedAt: '2026-08-09T22:00:00.000Z',
    evidenceFreshness: 'FRESH',
    manuallyPaused: false,
  }),
  variant({
    id: 'wb-black-750',
    optionLabel: 'Color: Black, Size: 750ml',
    sals3VariantId: 'SALS3-V-1004-B',
    sellerSku: 'S3-WB-BLACK-750',
    cjVariantId: 'CJVID-17309882010001-2',
    hasImage: true,
    sellingPriceMinor: 799,
    supplierCostMinor: 340,
    availability: 'OUT_OF_STOCK',
    stockEvidence: 'ZERO_STOCK',
    supplierObservedQuantity: 0,
    lastCheckedAt: '2026-08-09T22:00:00.000Z',
    evidenceFreshness: 'FRESH',
    manuallyPaused: false,
  }),
];

function noVariants(): CatalogueVariantFixture[] {
  return [];
}

const CATALOGUE_FIXTURES: CatalogueProductFixture[] = [
  {
    id: 'prod-cargo-shorts',
    sals3ProductId: 'SALS3-P-1001',
    name: 'Men Cargo Shorts 6 Pockets (Blue Camou)',
    hasImage: true,
    status: 'LIVE',
    categoryPath: 'Men / Bottoms / Shorts',
    createdAt: '2026-08-03T02:27:00.000Z',
    supplierProviderCode: SUPPLIER_PROVIDER_CODE,
    supplierProviderName: SUPPLIER_PROVIDER_NAME,
    supplierConnectionHealth: 'CONNECTED',
    cjProductId: '15560634326',
    sellingPrice: usd(599),
    availability: 'AVAILABLE',
    stockEvidence: 'CJ_WAREHOUSE_STOCK',
    supplierObservedQuantity: 45,
    lastCheckedAt: '2026-08-10T05:00:00.000Z',
    evidenceFreshness: 'FRESH',
    mediaStatus: 'OWN_PICTURES',
    contentReadiness: 'TOP',
    pauseReason: null,
    storefrontUrl: '/p/prod-cargo-shorts',
    attentionReasons: [],
    editorFixtureKey: 'pass',
    variants: [
      variant({
        id: 'cs-green-s',
        optionLabel: 'Color: Green, Size: Small 27-31',
        sals3VariantId: 'SALS3-V-1001-A',
        sellerSku: 'S3-CS-GRN-S',
        cjVariantId: 'CJVID-15560634326-1',
        hasImage: true,
        sellingPriceMinor: 599,
        supplierCostMinor: 260,
        availability: 'AVAILABLE',
        stockEvidence: 'CJ_WAREHOUSE_STOCK',
        supplierObservedQuantity: 15,
        lastCheckedAt: '2026-08-10T05:00:00.000Z',
        evidenceFreshness: 'FRESH',
        manuallyPaused: false,
      }),
      variant({
        id: 'cs-green-m',
        optionLabel: 'Color: Green, Size: Medium 31-35',
        sals3VariantId: 'SALS3-V-1001-B',
        sellerSku: 'S3-CS-GRN-M',
        cjVariantId: 'CJVID-15560634326-2',
        hasImage: true,
        sellingPriceMinor: 599,
        supplierCostMinor: 260,
        availability: 'AVAILABLE',
        stockEvidence: 'CJ_WAREHOUSE_STOCK',
        supplierObservedQuantity: 15,
        lastCheckedAt: '2026-08-10T05:00:00.000Z',
        evidenceFreshness: 'FRESH',
        manuallyPaused: false,
      }),
      variant({
        id: 'cs-green-l',
        optionLabel: 'Color: Green, Size: Large 35-39',
        sals3VariantId: 'SALS3-V-1001-C',
        sellerSku: 'S3-CS-GRN-L',
        cjVariantId: 'CJVID-15560634326-3',
        hasImage: true,
        sellingPriceMinor: 599,
        supplierCostMinor: 260,
        availability: 'AVAILABLE',
        stockEvidence: 'CJ_WAREHOUSE_STOCK',
        supplierObservedQuantity: 15,
        lastCheckedAt: '2026-08-10T05:00:00.000Z',
        evidenceFreshness: 'FRESH',
        manuallyPaused: false,
      }),
    ],
  },
  {
    id: 'prod-daypack',
    sals3ProductId: 'SALS3-P-1002',
    name: 'Aurelis 20L Packable Daypack',
    hasImage: true,
    status: 'LIVE_NEEDS_ATTENTION',
    categoryPath: 'Bags & Travel / Backpacks / Daypacks',
    createdAt: '2026-08-01T09:00:00.000Z',
    supplierProviderCode: SUPPLIER_PROVIDER_CODE,
    supplierProviderName: SUPPLIER_PROVIDER_NAME,
    supplierConnectionHealth: 'CONNECTED',
    cjProductId: 'CJPD2291845007',
    sellingPrice: usd(2490),
    availability: 'AVAILABLE',
    stockEvidence: 'CJ_WAREHOUSE_STOCK',
    supplierObservedQuantity: 412,
    lastCheckedAt: '2026-08-10T06:00:00.000Z',
    evidenceFreshness: 'FRESH',
    mediaStatus: 'MIXED_PICTURES',
    contentReadiness: 'GOOD',
    pauseReason: null,
    storefrontUrl: '/p/prod-daypack',
    attentionReasons: [
      attention({
        id: 'att-daypack-1',
        severity: 'MEDIUM',
        reasonCode: 'VARIANT_OUT_OF_STOCK',
        summary:
          'Clay 20L is out of stock. Slate 20L stays purchasable - only the affected variant is disabled.',
        checkoutAllowed: true,
      }),
    ],
    editorFixtureKey: 'attention',
    variants: DAYPACK_VARIANTS,
  },
  {
    id: 'prod-tote-bag',
    sals3ProductId: 'SALS3-P-1003',
    name: 'Canvas Tote Bag with Inner Pocket',
    hasImage: true,
    status: 'LIVE_NEEDS_ATTENTION',
    categoryPath: 'Bags & Travel / Totes',
    createdAt: '2026-07-28T14:10:00.000Z',
    supplierProviderCode: SUPPLIER_PROVIDER_CODE,
    supplierProviderName: SUPPLIER_PROVIDER_NAME,
    /**
     * Deliberately diverges from `availability` to prove the two dimensions
     * are independent: the connection is degraded (near the CJ points cap,
     * ADR-013 §5), yet the last trusted stock evidence still reads
     * `AVAILABLE` rather than being forced stale/unknown.
     */
    supplierConnectionHealth: 'DEGRADED',
    cjProductId: '17309210153073',
    sellingPrice: usd(449),
    availability: 'AVAILABLE',
    stockEvidence: 'CJ_WAREHOUSE_STOCK',
    supplierObservedQuantity: 132,
    lastCheckedAt: '2026-08-10T04:30:00.000Z',
    evidenceFreshness: 'FRESH',
    mediaStatus: 'SUPPLIER_PICTURES',
    contentReadiness: 'NEEDS_IMPROVEMENT',
    pauseReason: null,
    storefrontUrl: '/p/prod-tote-bag',
    attentionReasons: [
      attention({
        id: 'att-tote-1',
        severity: 'HIGH',
        reasonCode: 'SUPPLIER_COST_SPIKE',
        summary:
          'Supplier cost rose 42% since the last check. Your accepted customer price is unchanged - a margin-policy review is pending before any reprice.',
        checkoutAllowed: true,
      }),
    ],
    editorFixtureKey: 'price-spike',
    variants: noVariants(),
  },
  {
    id: 'prod-water-bottle',
    sals3ProductId: 'SALS3-P-1004',
    name: 'Insulated Steel Water Bottle 750ml',
    hasImage: true,
    status: 'AUTO_PAUSED',
    categoryPath: 'Sports & Outdoors / Drinkware',
    createdAt: '2026-07-15T11:40:00.000Z',
    supplierProviderCode: SUPPLIER_PROVIDER_CODE,
    supplierProviderName: SUPPLIER_PROVIDER_NAME,
    supplierConnectionHealth: 'CONNECTED',
    cjProductId: '17309882010001',
    sellingPrice: usd(799),
    availability: 'OUT_OF_STOCK',
    stockEvidence: 'ZERO_STOCK',
    supplierObservedQuantity: 0,
    lastCheckedAt: '2026-08-09T22:00:00.000Z',
    evidenceFreshness: 'FRESH',
    mediaStatus: 'SUPPLIER_PICTURES',
    contentReadiness: 'GOOD',
    pauseReason: 'All variants are out of stock at the supplier.',
    storefrontUrl: null,
    attentionReasons: [
      attention({
        id: 'att-bottle-1',
        severity: 'HIGH',
        reasonCode: 'ALL_VARIANTS_OUT_OF_STOCK',
        summary:
          'Every variant reports zero stock. New checkout is blocked until stock returns and every current gate passes again.',
        checkoutAllowed: false,
      }),
    ],
    editorFixtureKey: 'mixed-stock',
    variants: WATER_BOTTLE_VARIANTS,
  },
  {
    id: 'prod-desk-lamp',
    sals3ProductId: 'SALS3-P-1005',
    name: 'Foldable LED Desk Lamp',
    hasImage: true,
    status: 'DRAFT',
    categoryPath: 'Home & Living / Lighting',
    createdAt: '2026-07-10T08:20:00.000Z',
    supplierProviderCode: SUPPLIER_PROVIDER_CODE,
    supplierProviderName: SUPPLIER_PROVIDER_NAME,
    /** Degraded connection is the reason the evidence below is stale. */
    supplierConnectionHealth: 'DEGRADED',
    cjProductId: '17309882010088',
    sellingPrice: usd(1299),
    availability: 'UNKNOWN_OR_STALE',
    stockEvidence: 'UNKNOWN_STOCK',
    supplierObservedQuantity: null,
    lastCheckedAt: '2026-07-28T10:00:00.000Z',
    evidenceFreshness: 'UNKNOWN',
    mediaStatus: 'SUPPLIER_FALLBACK',
    contentReadiness: 'NEEDS_IMPROVEMENT',
    pauseReason: null,
    storefrontUrl: null,
    attentionReasons: [
      attention({
        id: 'att-lamp-1',
        severity: 'LOW',
        reasonCode: 'EVIDENCE_STALE',
        summary:
          'Last supplier stock check was 13 days ago. A fresh check is recommended before publishing.',
        checkoutAllowed: true,
      }),
    ],
    editorFixtureKey: 'stale-evidence',
    variants: noVariants(),
  },
  {
    id: 'prod-draft-hoodie',
    sals3ProductId: 'SALS3-P-1006',
    name: 'Quilted Zip-Up Hoodie (draft)',
    hasImage: true,
    status: 'DRAFT',
    categoryPath: 'Men / Outerwear',
    createdAt: '2026-08-09T05:00:00.000Z',
    supplierProviderCode: SUPPLIER_PROVIDER_CODE,
    supplierProviderName: SUPPLIER_PROVIDER_NAME,
    supplierConnectionHealth: 'CONNECTED',
    cjProductId: '17309882010200',
    sellingPrice: usd(1590),
    availability: 'SUPPLIER_CHECK_PENDING',
    stockEvidence: 'UNKNOWN_STOCK',
    supplierObservedQuantity: null,
    lastCheckedAt: '2026-08-10T01:00:00.000Z',
    evidenceFreshness: 'STALE',
    mediaStatus: 'NEEDS_MEDIA_REVIEW',
    contentReadiness: 'NEEDS_IMPROVEMENT',
    pauseReason: null,
    storefrontUrl: null,
    attentionReasons: [
      attention({
        id: 'att-hoodie-1',
        severity: 'MEDIUM',
        reasonCode: 'MEDIA_VARIANT_MISMATCH',
        summary:
          'The cover picture does not clearly match the "Charcoal" option. Review before this can publish.',
        checkoutAllowed: true,
      }),
    ],
    editorFixtureKey: 'pass',
    variants: noVariants(),
  },
  {
    id: 'prod-draft-cap',
    sals3ProductId: 'SALS3-P-1007',
    name: 'Corduroy Six-Panel Cap (draft)',
    hasImage: false,
    status: 'DRAFT',
    categoryPath: 'Accessories / Hats',
    createdAt: '2026-08-09T05:20:00.000Z',
    supplierProviderCode: SUPPLIER_PROVIDER_CODE,
    supplierProviderName: SUPPLIER_PROVIDER_NAME,
    supplierConnectionHealth: 'CONNECTED',
    cjProductId: '17309882010211',
    sellingPrice: usd(499),
    availability: 'AVAILABLE',
    stockEvidence: 'CJ_WAREHOUSE_STOCK',
    supplierObservedQuantity: 60,
    lastCheckedAt: '2026-08-10T02:10:00.000Z',
    evidenceFreshness: 'FRESH',
    mediaStatus: 'NO_USABLE_PICTURES',
    contentReadiness: 'NEEDS_IMPROVEMENT',
    pauseReason: null,
    storefrontUrl: null,
    attentionReasons: [
      attention({
        id: 'att-cap-1',
        severity: 'HIGH',
        reasonCode: 'NO_PUBLISHABLE_MEDIA',
        summary:
          'No rights-known, publishable picture exists yet. Publication is blocked until media is added.',
        checkoutAllowed: true,
      }),
    ],
    editorFixtureKey: 'pass',
    variants: noVariants(),
  },
  {
    id: 'prod-pending-sandals',
    sals3ProductId: 'SALS3-P-1008',
    name: 'Slip-On Sport Sandals',
    hasImage: true,
    status: 'LIVE_NEEDS_ATTENTION',
    categoryPath: 'Men / Footwear / Sandals',
    createdAt: '2026-08-08T16:45:00.000Z',
    supplierProviderCode: SUPPLIER_PROVIDER_CODE,
    supplierProviderName: SUPPLIER_PROVIDER_NAME,
    supplierConnectionHealth: 'CONNECTED',
    cjProductId: '17309882010333',
    sellingPrice: usd(699),
    availability: 'MARKET_UNAVAILABLE',
    stockEvidence: 'CJ_WAREHOUSE_STOCK',
    supplierObservedQuantity: 60,
    lastCheckedAt: '2026-08-10T03:00:00.000Z',
    evidenceFreshness: 'FRESH',
    mediaStatus: 'SUPPLIER_PICTURES',
    contentReadiness: 'GOOD',
    pauseReason: null,
    storefrontUrl: '/p/prod-pending-sandals',
    attentionReasons: [
      attention({
        id: 'att-sandals-1',
        severity: 'HIGH',
        reasonCode: 'NO_CONFIRMED_FREIGHT_ROUTE',
        summary:
          'Origin stock exists but there is no confirmed destination freight route for this enabled market. New checkout is blocked for that market.',
        checkoutAllowed: false,
      }),
    ],
    editorFixtureKey: 'market-route',
    variants: noVariants(),
  },
  {
    id: 'prod-pending-tumbler',
    sals3ProductId: 'SALS3-P-1009',
    name: 'Frosted Acrylic Tumbler 500ml',
    hasImage: true,
    status: 'AUTO_PAUSED',
    categoryPath: 'Home & Living / Drinkware',
    createdAt: '2026-08-08T17:05:00.000Z',
    supplierProviderCode: SUPPLIER_PROVIDER_CODE,
    supplierProviderName: SUPPLIER_PROVIDER_NAME,
    /** The disconnect itself is why availability derives to `SUPPLIER_DISCONNECTED` below. */
    supplierConnectionHealth: 'DISCONNECTED',
    cjProductId: '17309882010344',
    sellingPrice: usd(349),
    availability: 'SUPPLIER_DISCONNECTED',
    stockEvidence: 'UNKNOWN_STOCK',
    supplierObservedQuantity: null,
    lastCheckedAt: '2026-08-09T09:00:00.000Z',
    evidenceFreshness: 'STALE',
    mediaStatus: 'SUPPLIER_PICTURES',
    contentReadiness: 'GOOD',
    pauseReason:
      'Supplier connection disconnected. Reconnect in Supplier Apps to resume evaluation.',
    storefrontUrl: null,
    attentionReasons: [
      attention({
        id: 'att-tumbler-1',
        severity: 'CRITICAL',
        reasonCode: 'SUPPLIER_CONNECTION_DISCONNECTED',
        summary:
          'The supplier connection is not currently workable. New checkout is blocked until it reconnects and re-evaluates.',
        checkoutAllowed: false,
      }),
    ],
    editorFixtureKey: 'delisted',
    variants: noVariants(),
  },
  {
    id: 'prod-policy-hold-shirt',
    sals3ProductId: 'SALS3-P-1010',
    name: 'Graphic Print Tee ("N-Tech" logo)',
    hasImage: true,
    status: 'AUTO_PAUSED',
    categoryPath: 'Men / Tops',
    createdAt: '2026-07-30T12:00:00.000Z',
    supplierProviderCode: SUPPLIER_PROVIDER_CODE,
    supplierProviderName: SUPPLIER_PROVIDER_NAME,
    supplierConnectionHealth: 'CONNECTED',
    cjProductId: '17309882010500',
    sellingPrice: usd(549),
    availability: 'AVAILABLE',
    stockEvidence: 'CJ_WAREHOUSE_STOCK',
    supplierObservedQuantity: 25,
    lastCheckedAt: '2026-08-09T14:00:00.000Z',
    evidenceFreshness: 'FRESH',
    mediaStatus: 'SUPPLIER_PICTURES',
    contentReadiness: 'NEEDS_IMPROVEMENT',
    pauseReason:
      'Confirmed brand-authorization issue found post-publication. This cannot be resumed through the normal editor.',
    storefrontUrl: null,
    attentionReasons: [
      attention({
        id: 'att-shirt-1',
        severity: 'CRITICAL',
        reasonCode: 'POLICY_VIOLATION_CONFIRMED',
        summary:
          'A confirmed brand-authorization violation was found after this listing went live. It is blocked from new sales and cannot be resumed without a compliance override.',
        checkoutAllowed: false,
      }),
    ],
    editorFixtureKey: 'blocked',
    variants: noVariants(),
  },
  {
    id: 'prod-archived-scarf',
    sals3ProductId: 'SALS3-P-1011',
    name: 'Knit Infinity Scarf',
    hasImage: true,
    status: 'ARCHIVED',
    categoryPath: 'Accessories / Scarves',
    createdAt: '2026-06-20T10:00:00.000Z',
    supplierProviderCode: SUPPLIER_PROVIDER_CODE,
    supplierProviderName: SUPPLIER_PROVIDER_NAME,
    supplierConnectionHealth: 'CONNECTED',
    cjProductId: '17309882010600',
    sellingPrice: usd(399),
    availability: 'AVAILABLE',
    stockEvidence: 'CJ_WAREHOUSE_STOCK',
    supplierObservedQuantity: 0,
    lastCheckedAt: '2026-07-20T10:00:00.000Z',
    evidenceFreshness: 'STALE',
    mediaStatus: 'OWN_PICTURES',
    contentReadiness: 'GOOD',
    pauseReason: null,
    storefrontUrl: null,
    attentionReasons: [],
    editorFixtureKey: 'pass',
    variants: noVariants(),
  },
];

/** Every fixture's id, for tests that need to assert on a known row. */
export const CATALOGUE_FIXTURE_IDS = CATALOGUE_FIXTURES.map(
  (product) => product.id,
);

export function listCatalogueFixtures(): CatalogueProductFixture[] {
  return CATALOGUE_FIXTURES;
}
