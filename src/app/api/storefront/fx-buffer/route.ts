import isStorefrontRequestAuthorized from '@/lib/storefront/auth';
import readStorefrontFxBuffer from '@/lib/storefront/fx-buffer-cache';
import { toStorefrontFxBuffer } from '@/lib/storefront/fx-buffer-feed';
import {
  storefrontErrorResponse,
  STOREFRONT_HEADERS,
  unauthorizedResponse,
} from '../responses';

/**
 * The FX cushion the storefront applies to its approximate local price.
 *
 * This is the Market Rules → Funding buffer, and nothing else: the storefront
 * used to hard-code `2.5` while the screen a seller actually edits said
 * `+1.50%`. Two places stating one fact is the defect, not either place. See
 * `modules/pricing/storefront-fx-buffer.ts` for why it resolves through
 * published offers, and for the ADR-015 §4 line this deliberately stays on the
 * right side of — the charged price still applies the buffer exactly once, in
 * the resolver, and nothing here changes what anyone pays.
 *
 * ## `200 { buffer: null }` is a real answer, not a failure
 *
 * No active policy, an expired one, an out-of-band stored rate, or two sellers
 * disagreeing all resolve to `null`. A `503` is reserved for "the question
 * could not be asked at all", so the consumer can keep a last-known-good value
 * across a database blip without also keeping one across a deliberate
 * deactivation.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!isStorefrontRequestAuthorized(request)) {
    return unauthorizedResponse();
  }

  try {
    const result = await readStorefrontFxBuffer();

    if (result.outcome === 'AMBIGUOUS') {
      // Loud, because the storefront is about to stop showing local prices and
      // the cause is a business event (a second seller published with a
      // different buffer) rather than a fault. Named here so the log says
      // which of the `null`s this one is.
      // eslint-disable-next-line no-console
      console.warn(
        `[storefront-api] fx-buffer is ambiguous across ${result.sellerAccountCount} sellers; serving no buffer`,
      );
    }

    return Response.json(toStorefrontFxBuffer(result), {
      headers: STOREFRONT_HEADERS,
    });
  } catch (error) {
    return storefrontErrorResponse('fx-buffer', error);
  }
}
