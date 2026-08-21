import isStorefrontRequestAuthorized from '@/lib/storefront/auth';
import { isPublicSlug } from '@/lib/storefront/catalog-feed';
import {
  notFoundResponse,
  storefrontErrorResponse,
  STOREFRONT_HEADERS,
  unauthorizedResponse,
} from '../../../responses';

/**
 * GET /api/storefront/products/[id]/reviews — one published product's reviews.
 *
 * `[id]` is the public **slug**, matching the sibling detail route: the folder
 * name is historical, and that route's own note explains why renaming it is a
 * coordinated cross-repository change rather than a tidy-up.
 *
 * Separate from the product payload on purpose. The detail response already
 * carries the rating *summary* — the number every card and heading needs — while
 * the list is only read once a buyer scrolls to it, is bounded at 50, and grows
 * without limit as a product sells. Folding it into the cached product entry
 * would put an unbounded, frequently-changing array behind a 60-second cache
 * shared by every visitor to that page.
 *
 * A slug with no product and a product with no reviews both answer `200` with
 * an empty list, not `404`. "No reviews yet" is a real, renderable answer about
 * a real product, and the sibling route is where a bad slug is already told
 * apart from a good one.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  if (!isStorefrontRequestAuthorized(request)) {
    return unauthorizedResponse();
  }

  const { id } = await params;

  // Shape first: an unbounded or non-slug string is not a lookup, and
  // rejecting it here keeps a buyer-controlled value out of a query.
  if (!isPublicSlug(id)) return notFoundResponse();

  try {
    const { listPublicReviewsBySlug } =
      await import('@/modules/reviews/repository');
    const reviews = await listPublicReviewsBySlug(id);

    return Response.json({ reviews }, { headers: STOREFRONT_HEADERS });
  } catch (error) {
    return storefrontErrorResponse(`GET /products/${id}/reviews`, error);
  }
}
