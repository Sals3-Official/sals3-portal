import { z } from 'zod';

/**
 * CJdropshipping API response schemas.
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
 */

const CJ_IMAGE_HOSTS = ['cf.cjdropshipping.com', 'oss-cf.cjdropshipping.com'];

/**
 * Accepts an image address only from a CJ host that `next.config.ts` allows.
 * An address from anywhere else becomes null, so the upstream feed cannot make
 * the app request an image from a host we never approved.
 */
const cjImageUrl = z
  .string()
  .nullish()
  .transform((value) => {
    if (typeof value !== 'string' || value.trim() === '') {
      return null;
    }

    try {
      const url = new URL(value);

      return url.protocol === 'https:' && CJ_IMAGE_HOSTS.includes(url.hostname)
        ? url.toString()
        : null;
    } catch {
      return null;
    }
  });

const looseText = z
  .unknown()
  .transform((value) => (typeof value === 'string' ? value.trim() : ''));

const looseNumber = z.unknown().transform((value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
});

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
});

export type CjQuery = z.infer<typeof cjQuerySchema>;
