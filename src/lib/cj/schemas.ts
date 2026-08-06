import { z } from 'zod';
import { cjImageUrl, looseNumber, looseText } from './primitives';

/**
 * CJdropshipping `/product/list` response schemas.
 *
 * These are written to tolerate what the API actually returns, which differs
 * from its own documentation in several places: `sellPrice` arrives as a string
 * ("5.09"), `productWeight` as a range string ("300.00-340.00"), `createTime` as
 * epoch milliseconds rather than a date string, `addMarkStatus` as a string, and
 * `productUnit`, `isVideo`, and `supplierName` as null. Fields we do not read
 * are left out on purpose.
 *
 * Every field we do read is optional or nullable with a fallback, so one changed
 * or missing value upstream degrades a single cell instead of failing the page.
 *
 * Shared primitives live in `./primitives` so the enrichment schemas can reuse
 * them instead of redefining the same tolerances.
 */

export const cjProductSchema = z.object({
  pid: looseText,
  productName: looseText,
  productNameEn: looseText,
  productSku: looseText,
  productImage: cjImageUrl,
  productWeight: looseText,
  productType: looseText,
  categoryName: looseText,
  categoryId: looseText,
  sellPrice: looseText,
  listedNum: looseNumber,
  supplierName: looseText,
  isFreeShipping: z.unknown().transform((value) => value === true),
  createTime: looseNumber,
  shippingCountryCodes: z
    .unknown()
    .transform((value) =>
      Array.isArray(value)
        ? value.filter((code): code is string => typeof code === 'string')
        : [],
    ),
});

export const cjProductListSchema = z.object({
  code: z.number(),
  message: looseText,
  data: z
    .object({
      pageNum: looseNumber,
      pageSize: looseNumber,
      total: looseNumber,
      list: z.array(cjProductSchema).nullish(),
    })
    .nullish(),
});

export const cjAccessTokenSchema = z.object({
  code: z.number(),
  message: looseText,
  data: z
    .object({
      accessToken: z.string().min(1),
      accessTokenExpiryDate: looseText,
    })
    .nullish(),
});

/**
 * Query the portal may send upstream. Anything outside these bounds is clamped
 * or dropped rather than passed through, so a hand-edited URL cannot build an
 * arbitrary upstream request.
 */
export const cjQuerySchema = z.object({
  cjPage: z.coerce.number().int().min(1).max(500).catch(1).default(1),
  cjSearch: z.string().trim().max(80).catch('').default(''),
  cjPid: z.string().trim().max(200).catch('').default(''),
});

export type CjQuery = z.infer<typeof cjQuerySchema>;
