import { z } from 'zod';
import {
  cjImageUrl,
  cjPointsInfoSchema,
  looseArrayOf,
  looseBoolean,
  looseNumber,
  looseStringArray,
  looseText,
  looseVerifiedWarehouse,
} from './primitives';

/**
 * Schemas for the CJ enrichment calls behind candidate preflight evidence
 * (spec section 8.3). Shapes were captured from the live API on 2026-08-07,
 * not from CJ's documentation — see `docs` note in `./primitives`.
 *
 * Only three endpoints are modelled, deliberately:
 *  - `GET /product/query?pid=` — detail, and it already embeds `variants`, so
 *    the separate `/product/variant/query` call is unnecessary.
 *  - `GET /product/stock/getInventoryByPid?pid=` — per-warehouse totals and
 *    per-variant inventory in one call, instead of one call per `vid`.
 *  - `GET /product/productComments?pid=` — supplier-platform review evidence.
 *
 * Freight (`/logistic/freightCalculate`) is intentionally absent: it needs an
 * approved destination market, and ADR-003 has not approved one.
 */

/** One variant, as embedded in the detail response and in the variant list. */
export const cjVariantSchema = z.object({
  vid: looseText,
  pid: looseText,
  variantNameEn: looseText,
  variantSku: looseText,
  variantImage: cjImageUrl,
  /** e.g. "Black-1XL" — the option combination as CJ labels it. */
  variantKey: looseText,
  variantWeight: looseNumber,
  variantLength: looseNumber,
  variantWidth: looseNumber,
  variantHeight: looseNumber,
  variantVolume: looseNumber,
  variantSellPrice: looseNumber,
  /** Observed as null on the detail response; inventory comes from its own call. */
  inventoryNum: looseNumber,
});

/**
 * `GET /product/query`. `status` is carried through as an unvalidated
 * supplier claim: CJ returns `"3"` for the probed product and does not
 * document the value set, so nothing here decides whether a product is
 * "on sale". That judgement belongs to a hard gate with a documented mapping.
 */
export const cjProductDetailSchema = z.object({
  pid: looseText,
  productNameEn: looseText,
  productName: looseText,
  productSku: looseText,
  productImage: cjImageUrl,
  productImageSet: looseStringArray,
  productWeight: looseText,
  productType: looseText,
  categoryId: looseText,
  categoryName: looseText,
  entryCode: looseText,
  /** Supplier HTML. Never rendered without sanitising. */
  description: looseText,
  sellPrice: looseText,
  suggestSellPrice: looseText,
  listedNum: looseNumber,
  /** Undocumented value set; treated as an opaque supplier claim. */
  status: looseText,
  createrTime: looseText,
  materialNameEnSet: looseStringArray,
  packingNameEnSet: looseStringArray,
  productProEnSet: looseStringArray,
  productKeyEnSet: looseStringArray,
  variants: looseArrayOf(cjVariantSchema),
  isTestProduct: looseBoolean,
});

export const cjProductDetailResponseSchema = z.object({
  code: z.number(),
  message: looseText,
  pointsInfo: cjPointsInfoSchema,
  data: cjProductDetailSchema.nullish(),
});

/**
 * Product-level stock per warehouse, from `data.inventories`.
 *
 * These keys end in `Num`. The per-variant entries in
 * `data.variantInventories[].inventory` describe the same idea with DIFFERENT
 * names (`totalInventory`, not `totalInventoryNum`) and no area fields — see
 * `cjVariantStockSchema`. Verified live 2026-08-07. Sharing one schema between
 * the two silently parsed every per-variant total as null while real stock
 * existed, so they are deliberately kept apart.
 */
export const cjWarehouseInventorySchema = z.object({
  areaEn: looseText,
  countryCode: looseText,
  countryNameEn: looseText,
  totalInventoryNum: looseNumber,
  cjInventoryNum: looseNumber,
  factoryInventoryNum: looseNumber,
});

/**
 * Per-variant stock in one country, from
 * `data.variantInventories[].inventory[]`. Note the un-suffixed field names.
 *
 * `verifiedWarehouse` (`1` verified, `2` unverified, anything else/absent
 * `UNKNOWN`) was previously stripped at this boundary because the schema did
 * not declare it — ADR-013's corrected evidence model requires preserving it
 * per exact variant/origin rather than collapsing to a bare quantity.
 */
export const cjVariantStockSchema = z.object({
  countryCode: looseText,
  totalInventory: looseNumber,
  cjInventory: looseNumber,
  factoryInventory: looseNumber,
  verifiedWarehouse: looseVerifiedWarehouse,
});

/**
 * Per-variant inventory.
 *
 * The `variantInventories` order does NOT match the detail response's
 * `variants` order — verified live: `variantInventories[0].vid` was
 * `...611900` while `variants[0].vid` was `...610600`. Always join on `vid`,
 * never on array index.
 */
export const cjVariantInventorySchema = z.object({
  vid: looseText,
  inventory: looseArrayOf(cjVariantStockSchema),
});

export const cjInventoryResponseSchema = z.object({
  code: z.number(),
  message: looseText,
  pointsInfo: cjPointsInfoSchema,
  data: z
    .object({
      inventories: looseArrayOf(cjWarehouseInventorySchema),
      variantInventories: looseArrayOf(cjVariantInventorySchema),
    })
    .nullish(),
});

/**
 * `GET /product/productComments`. CJ returns a paged `total` plus a `list` of
 * individual comments. It documents no aggregate product rating and no
 * units-sold value, so neither is derived here. Anything computed from this is
 * CJ supplier-platform evidence, never a Sals3 buyer rating.
 */
export const cjCommentSchema = z.object({
  comment: looseText,
  commentDate: looseText,
  score: looseNumber,
  countryCode: looseText,
});

export const cjCommentsResponseSchema = z.object({
  code: z.number(),
  message: looseText,
  pointsInfo: cjPointsInfoSchema,
  data: z
    .object({
      total: looseNumber,
      list: looseArrayOf(cjCommentSchema),
    })
    .nullish(),
});

export type CjVariant = z.infer<typeof cjVariantSchema>;
export type CjProductDetail = z.infer<typeof cjProductDetailSchema>;
export type CjWarehouseInventory = z.infer<typeof cjWarehouseInventorySchema>;
export type CjVariantStock = z.infer<typeof cjVariantStockSchema>;
export type CjVariantInventory = z.infer<typeof cjVariantInventorySchema>;
export type CjComment = z.infer<typeof cjCommentSchema>;
