import isStorefrontRequestAuthorized from '@/lib/storefront/auth';
import { readStorefrontProduct } from '@/lib/storefront/catalog-cache';
import {
  isPublicSlug,
  toStorefrontProductDetail,
} from '@/lib/storefront/catalog-feed';
import {
  notFoundResponse,
  storefrontErrorResponse,
  STOREFRONT_HEADERS,
  unauthorizedResponse,
} from '../../responses';

/**
 * One published product, resolved **by its public slug**.
 *
 * The route folder is `[id]` for historical reasons — `sals3-ecommerce`'s
 * `fetchProductBySlug` puts the slug in this path segment and its cards link
 * by slug. Renaming the folder is a coordinated cross-repository change, so
 * the name stays and the parameter is read as what it is.
 *
 * There is no supplier lookup and no id guessing. The old handler asked CJ for
 * a `pid` using our own slugified form of it, then re-matched
 * case-insensitively because the filter could not be trusted — a guess by its
 * own admission. A slug is now a real, unique, indexed column.
 */
export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, { params }: RouteContext) {
  if (!isStorefrontRequestAuthorized(request)) {
    return unauthorizedResponse();
  }

  const { id } = await params;

  // Validate the shape before touching the database: an unbounded or
  // non-slug string is not a lookup, and rejecting it here keeps a
  // buyer-controlled value from reaching a query at all.
  if (!isPublicSlug(id)) {
    return notFoundResponse();
  }

  try {
    const row = await readStorefrontProduct(id);
    const product = row === null ? null : toStorefrontProductDetail(row);

    if (product === null) {
      return notFoundResponse();
    }

    return Response.json({ product }, { headers: STOREFRONT_HEADERS });
  } catch (error) {
    return storefrontErrorResponse('products/[id]', error);
  }
}
