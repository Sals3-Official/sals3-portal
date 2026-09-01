import isStorefrontRequestAuthorized from '@/lib/storefront/auth';
import { CHECKOUT_DESTINATION_CODES } from '@/modules/market-config/checkout-destinations';
import { freeShippingThresholdAmountMinor } from '@/modules/checkout/free-shipping';
import {
  storefrontErrorResponse,
  STOREFRONT_HEADERS,
  unauthorizedResponse,
} from '../responses';

/**
 * The free-Standard-delivery threshold for each checkout destination, in USD
 * minor units. Static Portal config, same class of read as `fx-buffer`: no
 * cart, no address, nothing that varies per request.
 *
 * ## Why this exists instead of every read going through freight-quotes
 *
 * `checkout/freight-quotes` is the only place `freeShippingProgress()` was
 * reachable from before this, and it requires a real address and computes real
 * CJ freight — expensive, and address-gated by design. The threshold itself is
 * a pure function of the country (`freeShippingThresholdAmountMinor`), so
 * asking for it does not need any of that. This route exists so the storefront
 * can show an *estimate* pre-checkout without either hard-coding the three
 * dollar figures on that side or paying for a freight quote to learn a number
 * that ignores freight entirely.
 *
 * ## A missing or malformed env var drops that one country, not the request
 *
 * Same rule `fx-buffer` follows for "no active policy": the honest answer for
 * one bad entry is silence for that entry, not a 500 that takes the other two
 * countries down with it.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!isStorefrontRequestAuthorized(request)) {
    return unauthorizedResponse();
  }

  try {
    const thresholds = Object.fromEntries(
      CHECKOUT_DESTINATION_CODES.flatMap((country) => {
        try {
          return [
            [country, freeShippingThresholdAmountMinor(country)],
          ] as const;
        } catch {
          return [];
        }
      }),
    );

    return Response.json(
      { thresholds, currency: 'USD' },
      { headers: STOREFRONT_HEADERS },
    );
  } catch (error) {
    return storefrontErrorResponse('free-shipping', error);
  }
}
