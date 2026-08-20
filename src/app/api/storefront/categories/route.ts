import isStorefrontRequestAuthorized from '@/lib/storefront/auth';
import {
  readStorefrontCategories,
  readStorefrontDepartments,
} from '@/lib/storefront/catalog-cache';
import {
  toStorefrontCategories,
  toStorefrontDepartments,
} from '@/lib/storefront/catalog-feed';
import {
  storefrontErrorResponse,
  STOREFRONT_HEADERS,
  unauthorizedResponse,
} from '../responses';

/**
 * The Sals3 main categories, in one of two scopes.
 *
 * - default (`?scope=stocked`, or no param): the main categories that have a
 *   published product behind them, so no empty tile can render.
 * - `?scope=all`: every main category the taxonomy defines — the storefront's
 *   "All departments" list, which shows the shape of the catalogue including
 *   the departments nothing is published in yet.
 *
 * Both scopes emit the same `{ id, code, name }` shape, so the consumer
 * validates one schema. An unrecognised `scope` falls back to the stocked
 * list rather than erroring: a bad query string must not take a browse
 * surface down.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!isStorefrontRequestAuthorized(request)) {
    return unauthorizedResponse();
  }

  const scope = new URL(request.url).searchParams.get('scope');

  try {
    const categories =
      scope === 'all'
        ? toStorefrontDepartments(await readStorefrontDepartments())
        : toStorefrontCategories(await readStorefrontCategories());

    return Response.json(categories, { headers: STOREFRONT_HEADERS });
  } catch (error) {
    return storefrontErrorResponse('categories', error);
  }
}
