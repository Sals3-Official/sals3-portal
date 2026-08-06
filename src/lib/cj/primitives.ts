import { z } from 'zod';

/**
 * Shared Zod primitives for every CJdropshipping response.
 *
 * CJ's real payloads differ from its own documentation, so these are written
 * to tolerate what the API actually returns rather than what it promises:
 * prices arrive as strings (`"6.25"`), weights as range strings
 * (`"300.00-340.00"`), timestamps as epoch milliseconds, and several
 * documented fields as `null`. Every reader gets a fallback so one changed
 * value upstream degrades a single field instead of failing the request.
 *
 * Verified against the live API on 2026-08-07 via `/product/query`,
 * `/product/stock/getInventoryByPid`, and `/product/productComments`.
 */

/** Hosts `next.config.ts` allows for product imagery. Keep the two in step. */
export const CJ_IMAGE_HOSTS = [
  'cf.cjdropshipping.com',
  'oss-cf.cjdropshipping.com',
];

/**
 * Accepts an image address only from an allow-listed CJ host. Anything else
 * becomes null, so an upstream change cannot make the app request an image
 * from a host we never approved.
 */
export const cjImageUrl = z
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

/**
 * Every primitive below is `.optional()` on purpose.
 *
 * `z.unknown()` still requires the key to be present, so without this a single
 * field disappearing upstream would fail the whole parse and lose an entire
 * response. Optional keeps the documented behaviour: one missing or changed
 * value degrades that one value, not the request.
 */

/** Any non-string, or a missing key, becomes an empty string. */
export const looseText = z
  .unknown()
  .optional()
  .transform((value) => (typeof value === 'string' ? value.trim() : ''));

/** Parses CJ's numeric-string fields; unusable or missing values become null. */
export const looseNumber = z
  .unknown()
  .optional()
  .transform((value) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Number.parseFloat(value);

      return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
  });

/** CJ sends booleans inconsistently; only a real `true` counts. */
export const looseBoolean = z
  .unknown()
  .optional()
  .transform((value) => value === true);

/** An array of strings, with every non-string member dropped. */
export const looseStringArray = z
  .unknown()
  .optional()
  .transform((value) =>
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [],
  );

/** An array parsed item-by-item, dropping members that do not fit `itemSchema`. */
export function looseArrayOf<T>(itemSchema: z.ZodType<T>) {
  return z
    .unknown()
    .optional()
    .transform((value) =>
      Array.isArray(value)
        ? value
            .map((item) => itemSchema.safeParse(item))
            .filter((result) => result.success)
            .map((result) => result.data)
        : [],
    );
}

/**
 * `pointsInfo` is returned on every CJ response. Observed live on
 * 2026-08-07: `{ total: 56107, usedToday: 50110, remaining: 51559 }`, with
 * roughly 10 points consumed per enrichment call. Recording it is how quota
 * becomes runtime state instead of something discovered through a 429.
 */
export const cjPointsInfoSchema = z
  .object({
    total: looseNumber,
    usedToday: looseNumber,
    remaining: looseNumber,
  })
  .nullish();

export type CjPointsInfo = z.infer<typeof cjPointsInfoSchema>;
