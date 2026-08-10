import { z } from 'zod';
import { cjPointsInfoSchema, looseNumber, looseText } from './primitives';

/**
 * CJdropshipping response schemas used only by continuous discovery: the
 * category tree and the webhook set/subscribe endpoints. Verified against
 * the official documentation on 2026-08-11:
 *
 * - `GET  /product/getCategory` - fixed three-level tree, no parameters,
 *   0 points (not in the documented cost table; the docs state endpoints
 *   not listed do not consume points).
 * - `POST /webhook/set` - per-topic ENABLE/CANCEL with one HTTPS callback
 *   URL.
 * - `POST /webhook/product/subscribe` / `/webhook/product/unsubscribe` -
 *   `productIds` arrays, maximum 100 per request, 10 points.
 * - `GET  /webhook/product/subscribe/list` - paged subscription listing.
 *
 * `subscribeAll` is deliberately NOT modelled anywhere: CJ documents it as
 * unavailable to all users after July 2026.
 *
 * Same tolerance philosophy as `schemas.ts`: fields we read are loose with
 * fallbacks so one upstream change degrades a value, not the whole response.
 */

export const cjCategoryThirdSchema = z.object({
  categoryId: looseText,
  categoryName: looseText,
});

export const cjCategorySecondSchema = z.object({
  categorySecondName: looseText,
  categorySecondList: z.array(cjCategoryThirdSchema).nullish(),
});

export const cjCategoryFirstSchema = z.object({
  categoryFirstName: looseText,
  categoryFirstList: z.array(cjCategorySecondSchema).nullish(),
});

export const cjCategoryTreeResponseSchema = z.object({
  code: z.number(),
  message: looseText,
  pointsInfo: cjPointsInfoSchema,
  data: z.array(cjCategoryFirstSchema).nullish(),
});

/**
 * Generic envelope for the webhook set/subscribe/unsubscribe mutations -
 * only `code`/`message` carry decision-relevant information.
 */
export const cjWebhookMutationResponseSchema = z.object({
  code: z.number(),
  message: looseText,
  pointsInfo: cjPointsInfoSchema,
  data: z.unknown().nullish(),
});

export const cjSubscriptionListResponseSchema = z.object({
  code: z.number(),
  message: looseText,
  pointsInfo: cjPointsInfoSchema,
  data: z
    .object({
      pageNum: looseNumber,
      pageSize: looseNumber,
      total: looseNumber,
      list: z
        .array(
          z.object({
            pid: looseText,
            productId: looseText,
          }),
        )
        .nullish(),
    })
    .nullish(),
});

export type CjCategoryTreeResponse = z.infer<
  typeof cjCategoryTreeResponseSchema
>;
