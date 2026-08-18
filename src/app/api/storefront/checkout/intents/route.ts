import isStorefrontRequestAuthorized from '@/lib/storefront/auth';
import {
  createCheckoutIntent,
  createCheckoutIntentSchema,
  CheckoutOrderError,
} from '@/modules/checkout/orders';
import {
  storefrontErrorResponse,
  STOREFRONT_HEADERS,
  unauthorizedResponse,
} from '../../responses';

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
      { error: 'Check your cart and address, then try again.' },
      { status: 400, headers: STOREFRONT_HEADERS },
    );
  }

  const parsed = createCheckoutIntentSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      { error: 'Check your cart and address, then try again.' },
      { status: 400, headers: STOREFRONT_HEADERS },
    );
  }

  try {
    return Response.json(await createCheckoutIntent(parsed.data), {
      headers: STOREFRONT_HEADERS,
    });
  } catch (error) {
    if (error instanceof CheckoutOrderError) {
      return Response.json(
        { error: error.message },
        { status: error.status, headers: STOREFRONT_HEADERS },
      );
    }

    return storefrontErrorResponse('checkout/intents', error);
  }
}
