import type { CatalogueProductFixture } from './types';

/**
 * How finished a listing is, as one Low / Medium / High reading.
 *
 * ## Why this is not the Attention column
 *
 * `attentionReasons` is ADR-007's supplier-change concept — delist, zero stock,
 * cost spike, freight loss, connection failure — the cases that protect checkout
 * and auto-pause a live listing. Today it only ever carries
 * `PUBLICATION_NOT_BUILT` and `PRICING_UNRESOLVED`, which the Listing Status and
 * Selling Price columns already state, so it reads as noise. That is a gap in
 * *that* feature, not a reason to spend the column: when real supplier-change
 * attention is wired, it needs somewhere to land. So quality is its own reading
 * and the two never merge.
 *
 * ## Presentation only
 *
 * This gates nothing. It blocks no publication, pauses no listing, and writes no
 * row. ADR-010 requires a versioned, shadow-measured, owner-approved score
 * before any automated decision may depend on one, and `products.score` is
 * still deliberately unwritten. This is a seller-facing summary of facts already
 * on screen — read it as a checklist, never as a verdict.
 *
 * ## The signals, and why each one
 *
 * Every signal is already on `CatalogueProductFixture`, so this costs no extra
 * query and cannot disagree with the columns beside it.
 *
 * `PUBLISH_CRITICAL` signals are the ones a listing genuinely cannot sell
 * without. Missing any of them is `LOW`, because calling such a listing Medium
 * would flatter it. Meeting all of them is `MEDIUM`. `HIGH` additionally
 * requires the finishing work — the seller's own photography, a named Variant
 * Matrix where one is derivable, a real Sals3 category rather than a mirrored
 * supplier guess, and the metadata that decides how the page reads in search.
 *
 * Owner decision 2026-08-18: `HIGH` requires a seller's own photo. Supplier
 * media is what a finished listing is meant to move off, so a listing running
 * on the supplier's pictures is not finished however complete the text is.
 */

export const LISTING_QUALITY_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const;

export type ListingQuality = (typeof LISTING_QUALITY_LEVELS)[number];

export const LISTING_QUALITY_LABELS: Record<ListingQuality, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
};

/** One checked fact, so the badge can explain itself instead of asserting a number. */
export type ListingQualitySignal = {
  id: string;
  label: string;
  met: boolean;
  /** Publish-critical signals decide LOW; the rest decide HIGH. */
  publishCritical: boolean;
};

/** A category code Sals3 actually curated, as opposed to a mirrored CJ guess. */
function hasCuratedCategory(product: CatalogueProductFixture): boolean {
  const code = product.categoryCode ?? null;

  return code !== null && !code.startsWith('CJ-');
}

/**
 * Whether every attribute the category marks `REQUIRED` has a stored value.
 *
 * Absent controls mean the category has none to satisfy, which passes: a
 * category with no required attributes must not hold a listing at Low forever.
 */
function requiredSpecsFilled(product: CatalogueProductFixture): boolean {
  const controls = product.categoryAttributeControls ?? [];
  const required = controls.filter(
    (control) => control.requirementLevel === 'REQUIRED',
  );

  if (required.length === 0) return true;

  const filled = new Set(
    (product.categoryAttributeValues ?? [])
      .filter((value) => value.values.length > 0)
      .map((value) => value.attributeName),
  );

  return required.every((control) => filled.has(control.attributeName));
}

/**
 * A Variant Matrix is only expected where the supplier's labels can produce one.
 *
 * `optionAxisNames` non-empty means it is named. An unmapped product passes only
 * when it has a single variant, where there is no axis to name — the same shape
 * `deriveOptionSplit` refuses for having fewer than two variants.
 */
function variantMatrixNamedIfExpected(
  product: CatalogueProductFixture,
): boolean {
  if ((product.optionAxisNames ?? []).length > 0) return true;

  return product.variants.length < 2;
}

export function listingQualitySignals(
  product: CatalogueProductFixture,
): ListingQualitySignal[] {
  return [
    {
      id: 'price',
      label: 'Retail price set',
      met: product.sellingPrice !== null,
      publishCritical: true,
    },
    {
      id: 'media',
      label: 'A publishable picture exists',
      met:
        product.mediaStatus !== 'NO_USABLE_PICTURES' &&
        product.mediaStatus !== 'NEEDS_MEDIA_REVIEW',
      publishCritical: true,
    },
    {
      id: 'specs',
      label: 'Required specifications filled',
      met: requiredSpecsFilled(product),
      publishCritical: true,
    },
    {
      id: 'own-media',
      label: 'Uses the seller’s own pictures',
      met:
        product.mediaStatus === 'OWN_PICTURES' ||
        product.mediaStatus === 'MIXED_PICTURES',
      publishCritical: false,
    },
    {
      id: 'description',
      label: 'Product description written',
      met: product.contentReadiness !== 'NEEDS_IMPROVEMENT',
      publishCritical: false,
    },
    {
      id: 'meta-description',
      label: 'Meta description saved',
      met: (product.metaDescriptionText ?? '').trim() !== '',
      publishCritical: false,
    },
    {
      id: 'variant-matrix',
      label: 'Variant Matrix named',
      met: variantMatrixNamedIfExpected(product),
      publishCritical: false,
    },
    {
      id: 'category',
      label: 'Sals3 category chosen',
      met: hasCuratedCategory(product),
      publishCritical: false,
    },
  ];
}

export function listingQualityOf(
  product: CatalogueProductFixture,
): ListingQuality {
  const signals = listingQualitySignals(product);

  if (signals.some((signal) => signal.publishCritical && !signal.met)) {
    return 'LOW';
  }

  return signals.every((signal) => signal.met) ? 'HIGH' : 'MEDIUM';
}
