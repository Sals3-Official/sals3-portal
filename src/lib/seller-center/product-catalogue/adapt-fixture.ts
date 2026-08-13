import type { StatusPillTone } from '@/components/seller-center/shared/StatusPill';
import { deriveProductAvailability } from './derive';
import {
  LISTING_STATUS_LABELS,
  type Availability,
  type CatalogueProductFixture,
  type CatalogueVariantFixture,
  type ListingStatus,
} from './types';
import {
  ENABLED,
  HIDDEN,
  disabled,
  value,
  absent,
  type CatalogueRowActionsView,
  type CatalogueRowView,
  type CatalogueStatusView,
  type CatalogueVariantView,
  type VariantActionView,
} from './view';

/**
 * `CatalogueProductFixture[] → CatalogueRowView[]` for the design preview at
 * `/design-preview/product-catalogue`.
 *
 * Every field is a `value(...)`: the fixtures are a complete fictional world,
 * so nothing here is absent and nothing is untracked. That is the point of the
 * adapter - it proves the shared row component can render the rich design
 * unchanged, which is what makes the honest `adapt-real` sibling trustworthy
 * rather than a second, quietly diverging UI.
 *
 * The gating decisions below are lifted verbatim from what the row components
 * used to compute inline, so the rendered DOM is unchanged.
 */

const LISTING_STATUS_TONE: Record<ListingStatus, StatusPillTone> = {
  DRAFT: 'neutral',
  LIVE: 'success',
  LIVE_NEEDS_ATTENTION: 'warning',
  AUTO_PAUSED: 'danger',
  ARCHIVED: 'neutral',
};

/** Availability states a seller cannot pause out of - the supplier drives them. */
const SUPPLIER_DRIVEN_UNAVAILABLE = new Set<Availability>([
  'OUT_OF_STOCK',
  'SUPPLIER_DISCONNECTED',
  'MARKET_UNAVAILABLE',
  'UNKNOWN_OR_STALE',
  'SUPPLIER_CHECK_PENDING',
]);

function presentStatus(status: ListingStatus): CatalogueStatusView {
  return {
    label: LISTING_STATUS_LABELS[status],
    tone: LISTING_STATUS_TONE[status],
  };
}

function variantAction(variant: CatalogueVariantFixture): VariantActionView {
  if (variant.manuallyPaused) {
    return {
      kind: 'RESUME',
      label: 'Review & resume',
      isDisabled: false,
      disabledReason: undefined,
    };
  }

  if (SUPPLIER_DRIVEN_UNAVAILABLE.has(variant.availability)) {
    return {
      kind: 'RECHECK',
      label: 'Request fresh check',
      isDisabled: false,
      disabledReason: undefined,
    };
  }

  return {
    kind: 'PAUSE',
    label: 'Pause variant',
    isDisabled: false,
    disabledReason: undefined,
  };
}

function adaptVariant(variant: CatalogueVariantFixture): CatalogueVariantView {
  return {
    id: variant.id,
    optionLabel: value(variant.optionLabel),
    sals3VariantId: variant.sals3VariantId,
    sellerSku: value(variant.sellerSku),
    supplierVariantId: value(variant.cjVariantId),
    hasImage: value(variant.hasImage),
    sellingPrice: value(variant.sellingPrice),
    supplierCost: value(variant.supplierCost),
    availability: value(variant.availability),
    supplierObservedQuantity:
      variant.supplierObservedQuantity === null
        ? absent('Supplier-reported quantity: unknown')
        : value(variant.supplierObservedQuantity),
    lastCheckedAt: value(variant.lastCheckedAt),
    action: variantAction(variant),
  };
}

function adaptActions(
  product: CatalogueProductFixture,
): CatalogueRowActionsView {
  const isLive =
    product.status === 'LIVE' || product.status === 'LIVE_NEEDS_ATTENTION';
  const canViewLive = isLive && product.storefrontUrl !== null;

  return {
    editHref: `/listings/new?fixture=${product.editorFixtureKey}`,
    editPrice: ENABLED,
    pause: isLive ? ENABLED : HIDDEN,
    resume: product.status === 'AUTO_PAUSED' ? ENABLED : HIDDEN,
    publish: product.status === 'DRAFT' ? ENABLED : HIDDEN,
    restore: product.status === 'ARCHIVED' ? ENABLED : HIDDEN,
    duplicate: ENABLED,
    viewLive: canViewLive ? ENABLED : disabled(' (not live)'),
    archive: product.status === 'ARCHIVED' ? HIDDEN : ENABLED,
  };
}

export default function adaptFixtureRows(
  products: CatalogueProductFixture[],
): CatalogueRowView[] {
  return products.map((product) => ({
    id: product.id,
    sals3ProductId: product.sals3ProductId,
    name: product.name,
    hasImage: value(product.hasImage),
    status: presentStatus(product.status),
    categoryPath: value(product.categoryPath),
    createdAt: product.createdAt,
    supplierProviderName: value(product.supplierProviderName),
    supplierReference: value(product.cjProductId),
    supplierConnectionHealth: value(product.supplierConnectionHealth),
    sellingPrice: value(product.sellingPrice),
    // Derived from the variant list when there is one, exactly as the row did.
    availability: value(
      deriveProductAvailability(product.variants, product.availability),
    ),
    mediaStatus: value(product.mediaStatus),
    contentReadiness: value(product.contentReadiness),
    attentionReasons: value(product.attentionReasons),
    pauseReason: value(
      product.status === 'AUTO_PAUSED' ? product.pauseReason : null,
    ),
    // The fixtures invent no supplier-evidence facts, so this stays empty and
    // the preview's markup is untouched by the field existing.
    evidenceNotes: [],
    variants: product.variants.map(adaptVariant),
    actions: adaptActions(product),
  }));
}
