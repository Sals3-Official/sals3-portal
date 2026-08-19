import isStorefrontRequestAuthorized from '@/lib/storefront/auth';
import { readBuyerOrder } from '@/modules/orders/buyer-read';
import {
  notFoundResponse,
  storefrontErrorResponse,
  STOREFRONT_HEADERS,
  unauthorizedResponse,
} from '../../responses';

/**
 * GET /api/storefront/orders/{orderNumber} — one order, if this buyer owns it.
 *
 * The ownership check lives in `buyer-read.ts`: an order that exists but
 * belongs to a different email returns the same 404 as one that never
 * existed, so whether a number is real is not learnable from this endpoint.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ORDER_NUMBER_PATTERN = /^S3-\d{8}-[0-9A-Fa-f]{10}$/;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orderNumber: string }> },
) {
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

  const { orderNumber } = await params;

  // Shape-checked before the database sees it; anything else is the same 404
  // an unknown number gets, not a distinguishable validation error.
  if (!ORDER_NUMBER_PATTERN.test(orderNumber)) {
    return notFoundResponse();
  }

  try {
    const order = await readBuyerOrder(buyerEmail, orderNumber);

    return order === null
      ? notFoundResponse()
      : Response.json({ order }, { headers: STOREFRONT_HEADERS });
  } catch (error) {
    return storefrontErrorResponse('orders/[orderNumber]', error);
  }
}
