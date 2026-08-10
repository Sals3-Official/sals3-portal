import { createHash } from 'crypto';
import type {
  CjComment,
  CjProductDetail,
  CjVariantInventory,
  CjVariantStock,
  CjWarehouseInventory,
} from './enrichment-schemas';
import { CJ_IMAGE_HOSTS, type VerifiedWarehouseState } from './primitives';
import { deriveStockEvidence, type StockEvidenceLabel } from './stock-evidence';

/**
 * Normalised preflight evidence for one CJ candidate (spec section 8.3).
 *
 * This is **evidence only**. It carries no decision, no quality score, and no
 * publish eligibility: the hard gates (8.5), scoring (8.6), and compliance
 * gate (14) are not implemented, and inventing any of them from this data
 * would be fabricating a result.
 *
 * No supplier request correlation ID is captured here: none of the three CJ
 * response envelopes this module reads (`/product/query`,
 * `/product/stock/getInventoryByPid`, `/product/productComments`) return one
 * — only `code`/`message`/`pointsInfo`/`data`. Fabricating one would violate
 * ADR-013's evidence-truth rule, so it is simply absent rather than invented.
 */

/**
 * One preserved CJ inventory observation for one variant in one country
 * (ADR-013). Raw components survive here even though `totalInventory` below
 * is a convenient derived sum — a future policy change must be able to
 * re-evaluate CJ-warehouse vs. factory-backed vs. unverified stock without
 * another supplier call.
 */
export type StockByOrigin = {
  countryCode: string;
  cjInventory: number | null;
  factoryInventory: number | null;
  totalInventory: number | null;
  verifiedWarehouse: VerifiedWarehouseState;
};

export type VariantEvidence = {
  vid: string;
  sku: string;
  /** CJ's own option label, e.g. "Black-1XL". Not a Sals3 option model. */
  optionLabel: string;
  priceUsd: number | null;
  weightGrams: number | null;
  /** Raw per-country observations, attached by `vid` — never by array index. */
  stockByOrigin: StockByOrigin[];
  /** Summed across origins for this variant. Null when CJ reported none. */
  totalInventory: number | null;
  /** Pure derivation from `stockByOrigin` (see `stock-evidence.ts`). Evidence only, not a decision. */
  stockEvidence: StockEvidenceLabel;
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

/** SHA-256 over the normalised evidence - shared by every caller that snapshots it. */
export function checksumOfEvidence(evidence: CandidateEvidence): string {
  return createHash('sha256').update(JSON.stringify(evidence)).digest('hex');
}

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
 * Preserves one variant's raw per-country stock rows exactly as CJ reported
 * them — `verifiedWarehouse` included — rather than collapsing straight to a
 * sum (ADR-013).
 */
function toStockByOrigin(stocks: CjVariantStock[]): StockByOrigin[] {
  return stocks.map((stock) => ({
    countryCode: stock.countryCode,
    cjInventory: stock.cjInventory,
    factoryInventory: stock.factoryInventory,
    totalInventory: stock.totalInventory,
    verifiedWarehouse: stock.verifiedWarehouse,
  }));
}

/**
 * Sums one variant's stock across countries.
 *
 * Reads `totalInventory` — the per-variant field name. The product-level
 * warehouse entries use `totalInventoryNum` instead; reusing one shape for
 * both made every variant report null while real stock existed.
 */
function sumVariantStock(stocks: StockByOrigin[]): number | null {
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
    variants: input.detail.variants.map((variant) => {
      const stockByOrigin = toStockByOrigin(
        inventoryByVid.get(variant.vid) ?? [],
      );

      return {
        vid: variant.vid,
        sku: variant.variantSku,
        optionLabel: variant.variantKey,
        priceUsd: variant.variantSellPrice,
        weightGrams: variant.variantWeight,
        stockByOrigin,
        totalInventory: sumVariantStock(stockByOrigin),
        stockEvidence: deriveStockEvidence(stockByOrigin),
      };
    }),
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
