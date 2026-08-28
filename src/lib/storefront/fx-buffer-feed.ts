import { z } from 'zod';
import type { StorefrontFxBufferResult } from '@/modules/pricing/storefront-fx-buffer';

/**
 * The `/api/storefront/fx-buffer` wire contract — a live cross-repository
 * dependency, mirrored by `sals3-ecommerce/src/lib/fx/buffer.ts`.
 *
 * Same discipline as `catalog-feed.ts`: this maps a resolved result to the
 * wire and does nothing else. No database access, no FX arithmetic. A pure
 * function, so the contract can be tested without a database.
 *
 * ## `buffer: null` is a value, not an omission
 *
 * No active policy, an expired one, an out-of-band stored rate and two sellers
 * disagreeing all project to `null`, and the consumer renders no local price
 * for every one of them. That is deliberate: the four are indistinguishable to
 * a buyer, and a consumer given four cases would eventually treat one of them
 * as "close enough to show something".
 *
 * The key is always present. Omitting it on the absent case would make "the
 * Portal says there is no buffer" and "this response is from an older Portal
 * that has never heard of buffers" the same payload, and those two must not
 * collapse — the first means show nothing, the second means the deploy order
 * went wrong.
 *
 * ## Additive-only
 *
 * Same rule as the product feed: the consumer validates this with a Zod schema
 * that rejects a malformed payload outright. Every new key is optional, and
 * the portal ships first.
 */

export const storefrontFxBufferSchema = z.object({
  buffer: z
    .object({
      /** Percent, e.g. `1.5` for the `+1.50%` the Market Rules card shows. */
      bufferPercent: z.number().finite(),
      policyVersion: z.number().int(),
      policyId: z.string(),
    })
    .nullable(),
});

export type StorefrontFxBufferPayload = z.infer<
  typeof storefrontFxBufferSchema
>;

export function toStorefrontFxBuffer(
  result: StorefrontFxBufferResult,
): StorefrontFxBufferPayload {
  return {
    buffer: result.outcome === 'RESOLVED' ? result.buffer : null,
  };
}
