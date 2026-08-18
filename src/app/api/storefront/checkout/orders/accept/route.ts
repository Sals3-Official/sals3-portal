import isStorefrontRequestAuthorized from '@/lib/storefront/auth';
import {
  acceptCheckoutOrder,
  acceptCheckoutOrderSchema,
  CheckoutOrderError,
} from '@/modules/checkout/orders';
import dispatchOutbox from '@/modules/catalog/discovery/outbox-dispatch';
import {
  storefrontErrorResponse,
  STOREFRONT_HEADERS,
  unauthorizedResponse,
} from '../../../responses';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!isStorefrontRequestAuthorized(request)) {
    return unauthorizedResponse();
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: 'Check your cart and payment, then try again.' },
      { status: 400, headers: STOREFRONT_HEADERS },
    );
  }

  const parsed = acceptCheckoutOrderSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      { error: 'Check your cart and payment, then try again.' },
      { status: 400, headers: STOREFRONT_HEADERS },
    );
  }

  try {
    const accepted = await acceptCheckoutOrder(parsed.data);

    await dispatchOutbox({
      batchSize: 1,
      idempotencyKeys: [`fulfill-order:${accepted.orderId}`],
      operations: ['FULFILL_ORDER'],
    }).catch((error: unknown) => {
      // eslint-disable-next-line no-console -- safe operational breadcrumb; never logs buyer, Stripe, address, or supplier payload data.
      console.error('[portal] storefront order fulfillment dispatch failed', {
        operation: 'FULFILL_ORDER',
        orderId: accepted.orderId,
        error: error instanceof Error ? error.message : 'unknown',
      });
    });

    return Response.json(accepted, {
      headers: STOREFRONT_HEADERS,
    });
  } catch (error) {
    if (error instanceof CheckoutOrderError) {
      return Response.json(
        { error: error.message },
        { status: error.status, headers: STOREFRONT_HEADERS },
      );
    }

    return storefrontErrorResponse('checkout/orders/accept', error);
  }
}
