import isStorefrontRequestAuthorized from '@/lib/storefront/auth';
import { readStorefrontSearch } from '@/lib/storefront/catalog-cache';
import {
  storefrontSearchQuerySchema,
  toStorefrontProductFeed,
} from '@/lib/storefront/catalog-feed';
import { departmentNameForSlug } from '@/modules/catalog/taxonomy/departments';
import {
  storefrontErrorResponse,
  STOREFRONT_HEADERS,
  unauthorizedResponse,
} from '../responses';

/**
 * Search the published catalogue — what `sals3-ecommerce`'s `/search` page and
 * its header box read.
 *
 * Reads the database and nothing else; `storefront/no-supplier-calls.test.ts`
 * asserts that over this module's import graph.
 *
 * ## An empty term is an empty result, not an error
 *
 * A buyer who clears the box, or lands on `/search` with no query, has not made
 * a malformed request. `400` there would turn an ordinary interaction into an
 * error page, so a blank `q` short-circuits to a well-formed empty feed without
 * touching the database. The consumer renders its own "search for something"
 * state from that.
 *
 * ## An unknown `category` narrows to nothing rather than being ignored
 *
 * `category` is a department slug, resolved through the same
 * `departmentNameForSlug` allow-list the browse route uses, so an unrecognised
 * value cannot reach the query. It returns an empty result rather than silently
 * searching the whole catalogue: a filter the caller asked for and did not get
 * is worse than a filter that matched nothing, because only one of the two is
 * visible in the answer.
 *
 * ## Rate limiting (rule 29, considered and declined)
 *
 * Search is named in rule 29, and this is the closest thing Sals3 has to it.
 * Declined for the reason recorded on the browse route: the only caller is the
 * storefront's own server, so a per-caller bucket throttles every buyer at once
 * and stops nobody already holding the shared bearer token. The work per
 * request is bounded — `q` at 80 characters, `limit` at 30, `page` at 10,000,
 * `category` from a 21-value allow-list — and repeats are served from
 * `catalog-cache.ts`.
 *
 * That balance changes if this is ever opened beyond the storefront, or if the
 * substring match is replaced by something materially more expensive per row.
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
    const query = storefrontSearchQuerySchema.parse({
      q: searchParams.get('q') ?? undefined,
      category: searchParams.get('category') ?? undefined,
      sort: searchParams.get('sort') ?? undefined,
      page: searchParams.get('page') ?? undefined,
      limit: searchParams.get('limit') ?? undefined,
      minPriceMinor: searchParams.get('minPriceMinor') ?? undefined,
      maxPriceMinor: searchParams.get('maxPriceMinor') ?? undefined,
    });

    const departmentName =
      query.category === undefined
        ? undefined
        : departmentNameForSlug(query.category);
    const narrowedToNothing =
      query.category !== undefined && departmentName === null;

    if (query.q === '' || narrowedToNothing) {
      return Response.json(
        toStorefrontProductFeed({ rows: [], total: 0 }, query),
        { headers: STOREFRONT_HEADERS },
      );
    }

    const page = await readStorefrontSearch(
      query.q,
      departmentName ?? undefined,
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
    return storefrontErrorResponse('search', error);
  }
}
