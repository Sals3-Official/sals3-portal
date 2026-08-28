import isStorefrontRequestAuthorized from '@/lib/storefront/auth';
import { listBuyerOrders } from '@/modules/orders/buyer-read';
import {
  storefrontErrorResponse,
  STOREFRONT_HEADERS,
  unauthorizedResponse,
} from '../responses';

/**
 * GET /api/storefront/orders — every order paid on one buyer account.
 *
 * Server-to-server only, behind the same bearer token as the rest of the
 * storefront API; the storefront's server verifies the buyer's session cookie
 * and passes the **verified** email in the `X-Buyer-Email` header. A header
 * rather than a query parameter so the address never lands in access logs or
 * proxy caches, and never a request-body value the caller could confuse with
 * user input — the storefront must only ever put a session-verified email
 * here, because this value *is* the authorisation (rules 20/21).
 *
 * The full set is returned (capped in `buyer-read.ts`) and the storefront
 * filters lanes/search/range itself: a buyer's order count is small, and
 * lane counts need the whole set anyway.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  if (!isStorefrontRequestAuthorized(request)) {
    return unauthorizedResponse();
  }

  const buyerEmail = request.headers.get('x-buyer-email') ?? '';

  if (buyerEmail.trim() === '' || buyerEmail.length > 254) {
    return Response.json(
      { error: 'Missing buyer identity' },
      { status: 400, headers: STOREFRONT_HEADERS },
    );
  }

  // Same trust model as `X-Buyer-Email`: the storefront resolves this from its
  // verified session cookie and never from anything the browser supplied. It is
  // optional so a storefront deployed before this header still reads its
  // pre-uid orders by email.
  const buyerUid = request.headers.get('x-buyer-uid')?.trim() ?? '';

  try {
    return Response.json(
      {
        orders: await listBuyerOrders(buyerEmail, {
          ...(buyerUid === '' || buyerUid.length > 128 ? {} : { buyerUid }),
        }),
      },
      { headers: STOREFRONT_HEADERS },
    );
  } catch (error) {
    return storefrontErrorResponse('orders', error);
  }
}
