import { SALS3_OFFICIAL_IDENTITY_ID } from '@/lib/auth/identity';
import type { CjProduct } from '@/lib/cj/normalize';
import type { CjQuery } from '@/lib/cj/schemas';
import getDb, { isDatabaseConfigured } from '@/lib/db/client';
import PostgresSupplierSecretStore from '@/lib/secrets/postgres-supplier-secret-store';
import CjSupplierAdapter from '@/modules/suppliers/providers/cj/cj-adapter';
import CjTokenManager from '@/modules/suppliers/providers/cj/cj-auth';
import {
  findConnectionBySellerAndProvider,
  findProviderByCode,
  findSellerAccountByIdentityId,
  isWorkableConnectionStatus,
} from '@/modules/suppliers/repository';
import { CJ_PAGE_SIZE, CjApiError } from '@/services/cj/config';

/**
 * Storefront supplier source - reads the CJ catalogue through the Sals3
 * Official Dropshipper's own supplier connection (ADR-006/ADR-008), replacing
 * the retired global `CJ_API_KEY` path.
 *
 * No `requirePermission` call here, on purpose: the storefront routes are
 * machine-to-machine, already authenticated by the `SALS3_STOREFRONT_API_TOKEN`
 * bearer check before any fetch, and the legacy permission check only ever
 * read the synthetic dev session - it asserted nothing on a headless route.
 * Tenancy is enforced where it is real: this module resolves exactly one
 * seller's connection through the tenant-scoped repository queries.
 *
 * Every failure becomes a `CjApiError` so the routes' existing handling turns
 * it into the same 502 envelope the consumer already tolerates; the detail
 * stays in the server log, never in the response.
 */

export type CjProductPage = {
  products: CjProduct[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

const CJ_PROVIDER_CODE = 'CJ_DROPSHIPPING';
const MAX_PAGES = 500;

function emptyPastLastPage(
  page: number,
  pageSize = CJ_PAGE_SIZE,
): CjProductPage {
  return {
    products: [],
    page,
    pageSize,
    total: (page - 1) * pageSize,
    totalPages: page - 1,
  };
}

/** Finds the official account's CJ connection, or `null` with a logged reason. */
async function resolveOfficialCjConnectionId(): Promise<string | null> {
  const db = getDb();

  const seller = await findSellerAccountByIdentityId(
    db,
    SALS3_OFFICIAL_IDENTITY_ID,
  );

  if (seller === null) {
    // eslint-disable-next-line no-console
    console.error(
      '[storefront-feed] the Sals3 Official seller account does not exist; run npm run bootstrap:cj',
    );
    return null;
  }

  const provider = await findProviderByCode(db, CJ_PROVIDER_CODE);

  if (provider === null) {
    // eslint-disable-next-line no-console
    console.error(
      '[storefront-feed] the CJ_DROPSHIPPING provider is not seeded; run npm run bootstrap:cj',
    );
    return null;
  }

  const connection = await findConnectionBySellerAndProvider(
    db,
    seller.id,
    provider.id,
  );

  if (connection === null) {
    // eslint-disable-next-line no-console
    console.error(
      '[storefront-feed] the official seller has no CJ connection; run npm run bootstrap:cj',
    );
    return null;
  }

  if (!isWorkableConnectionStatus(connection.status)) {
    // eslint-disable-next-line no-console
    console.error(
      `[storefront-feed] the official CJ connection is ${connection.status}; reconnect it from /supplier-apps`,
    );
    return null;
  }

  return connection.id;
}

export async function fetchStorefrontCjProducts(
  query: CjQuery,
): Promise<CjProductPage> {
  if (!isDatabaseConfigured()) {
    // eslint-disable-next-line no-console
    console.error(
      '[storefront-feed] DATABASE_URL is not set; the feed cannot resolve a supplier connection',
    );
    throw new CjApiError('missing-credentials');
  }

  let connectionId: string | null;

  try {
    connectionId = await resolveOfficialCjConnectionId();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[storefront-feed] connection lookup failed', error);
    throw new CjApiError('upstream-unavailable');
  }

  if (connectionId === null) {
    throw new CjApiError('missing-credentials');
  }

  const secretStore = new PostgresSupplierSecretStore();
  const adapter = new CjSupplierAdapter(
    secretStore,
    new CjTokenManager(secretStore),
  );

  let page: CjProductPage;

  try {
    page = await adapter.listCandidates(connectionId, {
      page: query.cjPage,
      search: query.cjSearch,
      pid: query.cjPid,
    });
  } catch (error) {
    if (error instanceof CjApiError) {
      // CJ's reported `total` is not a reliable bound on how many pages are
      // actually reachable - a page past the real depth surfaces as a
      // body-level error the adapter reports as `unexpected-response` (or
      // `authentication-failed` for body code 401). Past page 1 that cannot
      // be told apart from a genuine upstream problem, so treat it as "this
      // was the last page" rather than failing the whole feed - the same
      // choice the retired `fetchCjProducts` made. Known small delta from
      // legacy: a truly malformed body past page 1 also degrades to an empty
      // page here instead of a 502; it self-corrects on the next fetch after
      // the cache entry expires.
      if (
        query.cjPage > 1 &&
        (error.reason === 'unexpected-response' ||
          error.reason === 'authentication-failed')
      ) {
        return emptyPastLastPage(query.cjPage);
      }

      throw error;
    }

    // eslint-disable-next-line no-console
    console.error('[storefront-feed] supplier fetch failed', error);
    throw new CjApiError('upstream-unavailable');
  }

  if (page.products.length === 0 && query.cjPage > 1) {
    return emptyPastLastPage(query.cjPage, page.pageSize);
  }

  return {
    ...page,
    totalPages: Math.min(MAX_PAGES, page.totalPages),
  };
}
