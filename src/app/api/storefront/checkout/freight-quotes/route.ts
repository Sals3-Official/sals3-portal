import isStorefrontRequestAuthorized from '@/lib/storefront/auth';
import {
  checkoutFreightQuoteRequestSchema,
  CheckoutFreightQuoteError,
  quoteCheckoutFreight,
} from '@/modules/checkout/freight-quotes';
import {
  storefrontErrorResponse,
  STOREFRONT_HEADERS,
  unauthorizedResponse,
} from '../../responses';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isStorefrontRequestAuthorized(request)) {
    return unauthorizedResponse();
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: 'Check your cart and address, then try again.' },
      { status: 400, headers: STOREFRONT_HEADERS },
    );
  }

  const parsed = checkoutFreightQuoteRequestSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      { error: 'Check your cart and address, then try again.' },
      { status: 400, headers: STOREFRONT_HEADERS },
    );
  }

  try {
    return Response.json(await quoteCheckoutFreight(parsed.data), {
      headers: STOREFRONT_HEADERS,
    });
  } catch (error) {
    if (error instanceof CheckoutFreightQuoteError) {
      // eslint-disable-next-line no-console
      console.warn('[storefront-api] checkout/freight-quotes rejected', {
        reason: error.message,
      });

      return Response.json(
        { error: error.message },
        { status: 422, headers: STOREFRONT_HEADERS },
      );
    }

    return storefrontErrorResponse('checkout/freight-quotes', error);
  }
}
