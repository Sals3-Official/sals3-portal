import type {
  CjComment,
  CjProductDetail,
  CjVariantInventory,
  CjVariantStock,
  CjWarehouseInventory,
} from './enrichment-schemas';
import { CJ_IMAGE_HOSTS } from './primitives';

/**
 * Normalised preflight evidence for one CJ candidate (spec section 8.3).
 *
 * This is **evidence only**. It carries no decision, no quality score, and no
 * publish eligibility: the hard gates (8.5), scoring (8.6), and compliance
 * gate (14) are not implemented, and inventing any of them from this data
 * would be fabricating a result.
 */

export type VariantEvidence = {
  vid: string;
  sku: string;
  /** CJ's own option label, e.g. "Black-1XL". Not a Sals3 option model. */
  optionLabel: string;
  priceUsd: number | null;
  weightGrams: number | null;
  /** Summed across warehouses for this variant. Null when CJ reported none. */
  totalInventory: number | null;
};

export type WarehouseEvidence = {
  countryCode: string;
  name: string;
  totalInventory: number | null;
};

/**
 * CJ supplier-platform review evidence — never a Sals3 buyer rating, and
 * never presented as one (spec section 8.7). `sampledAverageScore` is the
 * plain mean of the fetched page only; it is not confidence-adjusted, because
 * the scoring policy that would do that is not implemented.
 */
export type ReviewEvidence = {
  totalCount: number;
  sampledCount: number;
  sampledAverageScore: number | null;
};

export type CandidateEvidence = {
  externalProductId: string;
  name: string;
  supplierSku: string;
  categoryName: string;
  /** CJ customs/entry code. A supplier hint, not a verified classification. */
  entryCode: string;
  supplierPriceUsd: number | null;
  packedWeight: string;
  /** CJ's undocumented status value, carried through unjudged. */
  sourceStatusRaw: string;
  isTestProduct: boolean;
  listedCount: number | null;
  /** Platform listing count, never units sold (spec section 8.2). */
  usableImageCount: number;
  variants: VariantEvidence[];
  warehouses: WarehouseEvidence[];
  reviews: ReviewEvidence;
  capturedAt: string;
};

function isAllowedImage(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' && CJ_IMAGE_HOSTS.includes(parsed.hostname)
    );
  } catch {
    return false;
  }
}

/** Counts only images we would actually be allowed to serve. */
export function countUsableImages(detail: CjProductDetail): number {
  const candidates = new Set<string>();

  if (detail.productImage !== null) candidates.add(detail.productImage);
  detail.productImageSet.filter(isAllowedImage).forEach((url) => {
    candidates.add(url);
  });

  return candidates.size;
}

function parseUsd(value: string): number | null {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Sums one variant's stock across countries.
 *
 * Reads `totalInventory` — the per-variant field name. The product-level
 * warehouse entries use `totalInventoryNum` instead; reusing one shape for
 * both made every variant report null while real stock existed.
 */
function sumVariantStock(stocks: CjVariantStock[]): number | null {
  const values = stocks
    .map((stock) => stock.totalInventory)
    .filter((value): value is number => value !== null);

  return values.length === 0
    ? null
    : values.reduce((total, value) => total + value, 0);
}

export function summariseReviews(
  total: number | null,
  comments: CjComment[],
): ReviewEvidence {
  const scores = comments
    .map((comment) => comment.score)
    .filter((score): score is number => score !== null);

  return {
    totalCount: total ?? 0,
    sampledCount: comments.length,
    sampledAverageScore:
      scores.length === 0
        ? null
        : scores.reduce((sum, score) => sum + score, 0) / scores.length,
  };
}

/**
 * Joins the three CJ responses into one evidence record.
 *
 * Inventory is matched by `vid`, never by array position: CJ returns
 * `variantInventories` in a different order from the detail response's
 * `variants` (verified live 2026-08-07). Index-joining would silently attach
 * the wrong stock to the wrong variant.
 */
export default function toCandidateEvidence(input: {
  detail: CjProductDetail;
  warehouseInventories: CjWarehouseInventory[];
  variantInventories: CjVariantInventory[];
  reviewTotal: number | null;
  comments: CjComment[];
  capturedAt: Date;
}): CandidateEvidence {
  const inventoryByVid = new Map(
    input.variantInventories.map((entry) => [entry.vid, entry.inventory]),
  );

  return {
    externalProductId: input.detail.pid,
    name:
      input.detail.productNameEn !== ''
        ? input.detail.productNameEn
        : input.detail.productName,
    supplierSku: input.detail.productSku,
    categoryName: input.detail.categoryName,
    entryCode: input.detail.entryCode,
    supplierPriceUsd: parseUsd(input.detail.sellPrice),
    packedWeight: input.detail.productWeight,
    sourceStatusRaw: input.detail.status,
    isTestProduct: input.detail.isTestProduct,
    listedCount: input.detail.listedNum,
    usableImageCount: countUsableImages(input.detail),
    variants: input.detail.variants.map((variant) => ({
      vid: variant.vid,
      sku: variant.variantSku,
      optionLabel: variant.variantKey,
      priceUsd: variant.variantSellPrice,
      weightGrams: variant.variantWeight,
      totalInventory: sumVariantStock(inventoryByVid.get(variant.vid) ?? []),
    })),
    warehouses: input.warehouseInventories.map((warehouse) => ({
      countryCode: warehouse.countryCode,
      name:
        warehouse.countryNameEn !== ''
          ? warehouse.countryNameEn
          : warehouse.areaEn,
      totalInventory: warehouse.totalInventoryNum,
    })),
    reviews: summariseReviews(input.reviewTotal, input.comments),
    capturedAt: input.capturedAt.toISOString(),
  };
}
