import isStorefrontRequestAuthorized from '@/lib/storefront/auth';
import { readStorefrontFeed } from '@/lib/storefront/catalog-cache';
import {
  storefrontFeedQuerySchema,
  toStorefrontProductFeed,
} from '@/lib/storefront/catalog-feed';
import {
  storefrontErrorResponse,
  STOREFRONT_HEADERS,
  unauthorizedResponse,
} from '../responses';

/**
 * The published Sals3 catalogue feed. Reads the database and nothing else —
 * no supplier call is reachable from this module's import graph, which
 * `modules/catalog/storefront/no-supplier-calls.test.ts` asserts.
 *
 * `force-dynamic` because the response is per-request authorized; the caching
 * that matters happens in `catalog-cache.ts`, behind the auth check.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!isStorefrontRequestAuthorized(request)) {
    return unauthorizedResponse();
  }

  try {
    const { searchParams } = new URL(request.url);
    const query = storefrontFeedQuerySchema.parse({
      section: searchParams.get('section') ?? undefined,
      page: searchParams.get('page') ?? undefined,
      limit: searchParams.get('limit') ?? undefined,
    });
    const page = await readStorefrontFeed(
      query.section,
      query.page,
      query.limit,
    );

    return Response.json(toStorefrontProductFeed(page, query), {
      headers: STOREFRONT_HEADERS,
    });
  } catch (error) {
    return storefrontErrorResponse('products', error);
  }
}
