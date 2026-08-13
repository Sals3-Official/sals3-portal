import isStorefrontRequestAuthorized from '@/lib/storefront/auth';
import { readStorefrontCategories } from '@/lib/storefront/catalog-cache';
import { toStorefrontCategories } from '@/lib/storefront/catalog-feed';
import {
  storefrontErrorResponse,
  STOREFRONT_HEADERS,
  unauthorizedResponse,
} from '../responses';

/**
 * The Sals3 categories that actually have a published product behind them.
 * Derived from the catalogue, so no empty category tile can render.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!isStorefrontRequestAuthorized(request)) {
    return unauthorizedResponse();
  }

  try {
    const rows = await readStorefrontCategories();

    return Response.json(toStorefrontCategories(rows), {
      headers: STOREFRONT_HEADERS,
    });
  } catch (error) {
    return storefrontErrorResponse('categories', error);
  }
}
