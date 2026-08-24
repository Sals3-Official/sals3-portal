import isStorefrontRequestAuthorized from '@/lib/storefront/auth';
import { readStorefrontDepartmentFeed } from '@/lib/storefront/catalog-cache';
import {
  storefrontDepartmentQuerySchema,
  toStorefrontProductFeed,
} from '@/lib/storefront/catalog-feed';
import { departmentNameForSlug } from '@/modules/catalog/taxonomy/departments';
import {
  notFoundResponse,
  storefrontErrorResponse,
  STOREFRONT_HEADERS,
  unauthorizedResponse,
} from '../../../responses';

/**
 * The published products of one L1 department — what `sals3-ecommerce`'s
 * `/c/[slug]` page lists.
 *
 * Reads the database and nothing else; `storefront/no-supplier-calls.test.ts`
 * asserts that over this module's import graph.
 *
 * ## Why a nested route and not `?category=` on the feed
 *
 * `/api/storefront/products` takes a `section`, which *is* an ordering over the
 * whole catalogue. A department browse needs its own ordering vocabulary, so
 * the two would have had to share one route with `section` and `sort` fighting
 * over the same job — and any change to that query touches the live home feed.
 * The department is the resource here, so it names the path.
 *
 * ## Why an unknown slug is a 404 and not an empty page
 *
 * `departmentNameForSlug` is the allow-list: only the 21 taxonomy departments
 * resolve to a name, and only a resolved name reaches the query. An
 * unrecognised slug therefore cannot be filtered on — and answering `200` with
 * `products: []` would tell a buyer that a department they invented exists and
 * happens to be empty, which is the same lie the storefront's own
 * "Nothing published yet" panel would then repeat.
 *
 * `force-dynamic` because the response is per-request authorized; the caching
 * that matters happens in `catalog-cache.ts`, behind the auth check.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  if (!isStorefrontRequestAuthorized(request)) {
    return unauthorizedResponse();
  }

  try {
    const { slug } = await params;
    const departmentName = departmentNameForSlug(slug);

    if (departmentName === null) {
      return notFoundResponse();
    }

    const { searchParams } = new URL(request.url);
    const query = storefrontDepartmentQuerySchema.parse({
      sort: searchParams.get('sort') ?? undefined,
      page: searchParams.get('page') ?? undefined,
      limit: searchParams.get('limit') ?? undefined,
      minPriceMinor: searchParams.get('minPriceMinor') ?? undefined,
      maxPriceMinor: searchParams.get('maxPriceMinor') ?? undefined,
    });
    const page = await readStorefrontDepartmentFeed(
      departmentName,
      query.sort,
      query.page,
      query.limit,
      query.minPriceMinor,
      query.maxPriceMinor,
    );

    return Response.json(toStorefrontProductFeed(page, query), {
      headers: STOREFRONT_HEADERS,
    });
  } catch (error) {
    return storefrontErrorResponse('categories/[slug]/products', error);
  }
}
