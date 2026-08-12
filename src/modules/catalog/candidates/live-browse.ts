import type { CjProduct } from '@/lib/cj/normalize';
import getDb from '@/lib/db/client';
import { checkRateLimit } from '@/lib/rate-limit';
import {
  findConnectionBySellerAndProvider,
  findProviderByCode,
  isWorkableConnectionStatus,
} from '@/modules/suppliers/repository';
import type {
  SupplierCategoryLeaf,
  SupplierProviderAdapter,
} from '@/modules/suppliers/contracts';
import { CjApiError } from '@/services/cj/config';
import {
  findPipelineMatchesByPid,
  type SupplierProductMatch,
} from './supplier-products-queries';

/**
 * Live browse loader for **All Supplier Products** (owner decision
 * 2026-08-13): the page's product rows come from a live CJ `/product/list`
 * read on every render, overlaid with this seller's own pipeline state from
 * the Sals3 database.
 *
 * Strictly read-only against the pipeline: this module performs zero writes.
 * Browsing never inserts, refreshes, or evaluates a candidate - the discovery
 * workers remain the only writers. The one guardrail here is a per-user
 * in-process token bucket checked BEFORE the supplier call, so a fast-paging
 * seller is slowed by a local notice instead of spending the shared CJ points
 * budget the discovery pipeline also runs on.
 */

const CJ_PROVIDER_CODE = 'CJ_DROPSHIPPING';

/** Owner decision: one live browse page shows 200 products (CJ documented max). */
export const LIVE_BROWSE_PAGE_SIZE = 200;

/**
 * 30 CJ calls per user per minute: capacity 30, one token back every 2s.
 * `checkRateLimit` refills one token per interval, so the interval - not the
 * capacity - sets the sustained rate.
 */
const THROTTLE = { capacity: 30, refillIntervalMs: 2_000 } as const;

/** Category options change rarely; cache per connection for one hour. */
const CATEGORY_TREE_TTL_MS = 60 * 60 * 1_000;

export type LiveBrowseErrorState =
  | 'no-connection'
  | 'reauth-required'
  | 'rate-limited'
  | 'throttled-locally'
  | 'unavailable';

export type LiveBrowseRow = {
  live: CjProduct;
  /** Pipeline overlay when this pid is already a discovered candidate. */
  match: SupplierProductMatch | null;
};

export type LiveBrowsePage = {
  rows: LiveBrowseRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  matchedOnPage: number;
  categories: SupplierCategoryLeaf[];
};

export type LiveBrowseResult =
  | { ok: true; page: LiveBrowsePage }
  | { ok: false; state: LiveBrowseErrorState };

export type LiveBrowseQuery = {
  page: number;
  search: string;
  categoryId: string;
  orderBy?: 'createAt' | 'listedNum';
  sort?: 'asc' | 'desc';
};

export type LiveBrowseDeps = {
  adapter: SupplierProviderAdapter;
  /** Injectable clock for the throttle and category cache in tests. */
  now?: () => number;
};

type ConnectionResolution =
  | { ok: true; connectionId: string }
  | { ok: false; state: 'no-connection' | 'reauth-required' };

/**
 * The signed-in seller's own CJ connection - session-scoped, never a shared
 * or bootstrap identity.
 */
export async function resolveSellerCjConnection(
  sellerAccountId: string,
): Promise<ConnectionResolution> {
  const db = getDb();
  const provider = await findProviderByCode(db, CJ_PROVIDER_CODE);

  if (provider === null) return { ok: false, state: 'no-connection' };

  const connection = await findConnectionBySellerAndProvider(
    db,
    sellerAccountId,
    provider.id,
  );

  if (connection === null) return { ok: false, state: 'no-connection' };

  if (!isWorkableConnectionStatus(connection.status)) {
    return { ok: false, state: 'reauth-required' };
  }

  return { ok: true, connectionId: connection.id };
}

type CategoryCacheEntry = {
  leaves: SupplierCategoryLeaf[];
  expiresAt: number;
};

const categoryCache = new Map<string, CategoryCacheEntry>();

/** Test-only reset. */
export function resetLiveBrowseCategoryCache(): void {
  categoryCache.clear();
}

/**
 * Category filter options from the live CJ tree, cached per connection so the
 * dropdown does not add a second supplier request to every page view. A tree
 * failure degrades to no options - the product list must not fail because a
 * filter's options did.
 */
async function loadCategories(
  deps: LiveBrowseDeps,
  connectionId: string,
  now: number,
): Promise<SupplierCategoryLeaf[]> {
  const cached = categoryCache.get(connectionId);

  if (cached !== undefined && cached.expiresAt > now) return cached.leaves;

  try {
    const leaves = await deps.adapter.getCategoryTree(connectionId);

    categoryCache.set(connectionId, {
      leaves,
      expiresAt: now + CATEGORY_TREE_TTL_MS,
    });

    return leaves;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[live-browse] category tree read failed', error);
    return cached?.leaves ?? [];
  }
}

function toErrorState(error: unknown): LiveBrowseErrorState {
  if (error instanceof CjApiError) {
    if (error.reason === 'rate-limited') return 'rate-limited';
    if (
      error.reason === 'authentication-failed' ||
      error.reason === 'missing-credentials'
    ) {
      return 'reauth-required';
    }
  }

  return 'unavailable';
}

export async function loadLiveBrowsePage(
  deps: LiveBrowseDeps,
  input: { sellerAccountId: string; userId: string; query: LiveBrowseQuery },
): Promise<LiveBrowseResult> {
  const now = deps.now ?? Date.now;

  let connection: ConnectionResolution;

  try {
    connection = await resolveSellerCjConnection(input.sellerAccountId);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[live-browse] connection lookup failed', error);
    return { ok: false, state: 'unavailable' };
  }

  if (!connection.ok) return { ok: false, state: connection.state };

  // Checked BEFORE the supplier call: a throttled render spends no CJ points.
  const throttle = checkRateLimit(
    `products:live-browse:${input.userId}`,
    THROTTLE,
    now(),
  );

  if (!throttle.allowed) return { ok: false, state: 'throttled-locally' };

  let page;

  try {
    page = await deps.adapter.listBrowsePage(connection.connectionId, {
      pageNum: input.query.page,
      pageSize: LIVE_BROWSE_PAGE_SIZE,
      ...(input.query.search === '' ? {} : { search: input.query.search }),
      ...(input.query.categoryId === ''
        ? {}
        : { categoryId: input.query.categoryId }),
      ...(input.query.orderBy === undefined
        ? {}
        : { orderBy: input.query.orderBy }),
      ...(input.query.sort === undefined ? {} : { sort: input.query.sort }),
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[live-browse] supplier list read failed', error);
    return { ok: false, state: toErrorState(error) };
  }

  const [matches, categories] = await Promise.all([
    findPipelineMatchesByPid(
      input.sellerAccountId,
      page.products.map((product) => product.id),
    ),
    loadCategories(deps, connection.connectionId, now()),
  ]);

  const rows: LiveBrowseRow[] = page.products.map((product) => ({
    live: product,
    match: matches.get(product.id) ?? null,
  }));

  return {
    ok: true,
    page: {
      rows,
      total: page.total,
      page: input.query.page,
      pageSize: LIVE_BROWSE_PAGE_SIZE,
      totalPages: page.totalPages,
      matchedOnPage: rows.filter((row) => row.match !== null).length,
      categories,
    },
  };
}
