import type { CjProduct } from '@/lib/cj/normalize';
import type { CandidateEvidence } from '@/lib/cj/evidence';
import type { CjPointsInfo } from '@/lib/cj/primitives';

/**
 * Provider-agnostic boundary every supplier integration implements. A page
 * or Server Component never instantiates a provider client directly - it
 * goes through this interface, resolved for one connection at a time.
 */

export type ConnectionHealth = {
  status: 'CONNECTED' | 'DEGRADED' | 'REAUTH_REQUIRED';
  lastVerifiedAt: Date;
  lastErrorCode: string | null;
};

export type CandidateListInput = {
  page: number;
  search: string;
  pid: string;
};

export type CandidatePage = {
  products: CjProduct[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

/**
 * Documented legacy `GET /api2.0/v1/product/list` filters used by the
 * discovery scanner (verified against the official CJ docs 2026-08-11):
 * `pageNum`, `pageSize` (max 200), `categoryId`, `createTimeFrom`/`To`
 * (`yyyy-MM-dd hh:mm:ss` strings - timezone is NOT documented; the caller
 * formats via configuration, see the discovery config), `minPrice`/
 * `maxPrice`, `orderBy=createAt` with one fixed `sort` direction.
 */
export type CatalogPageQuery = {
  pageNum: number;
  /** 1..200. The documented legacy maximum is 200. */
  pageSize: number;
  categoryId?: string;
  /** Pre-formatted provider wire value, `yyyy-MM-dd hh:mm:ss`. */
  createTimeFrom?: string;
  createTimeTo?: string;
  /** USD major units with two decimals, e.g. 12.5. */
  minPrice?: number;
  maxPrice?: number;
};

export type CatalogPage = {
  products: CjProduct[];
  /** The page number this caller asked for - kept so validation can compare. */
  requestedPageNum: number;
  /** The page number the provider says it returned. */
  pageNum: number;
  pageSize: number;
  total: number;
  /**
   * Derived (`ceil(total / pageSize)`): the legacy list envelope carries no
   * totalPages field, so this is safe arithmetic on the provider's own
   * reported values, never an invented count.
   */
  totalPages: number;
  /** Provider quota state from this exact response, when present. */
  pointsInfo: CjPointsInfo;
};

/**
 * Curated discovery query: the same legacy `GET /api2.0/v1/product/list`
 * endpoint, with the owner-approved ranking parameters for the CJ Trending /
 * Most listed / New arrivals lanes. Never `product/listV2`.
 *
 * `searchType` is passed through exactly as the owner specified it
 * (`searchType=2` for CJ Trending). It is NOT part of the legacy filter set
 * this repository verified against CJ's documentation on 2026-08-11, so its
 * response contract is a labelled assumption: a lane whose page fails
 * validation records an ordinary contract error and never claims coverage.
 */
export type CuratedPageQuery = {
  pageNum: number;
  /** 1..200. The documented legacy maximum is 200. */
  pageSize: number;
  /** Provider curated-set selector, e.g. `2` for CJ Trending. */
  searchType?: number;
  /** Documented legacy ordering values. */
  orderBy?: 'createAt' | 'listedNum';
  sort?: 'asc' | 'desc';
  categoryId?: string;
  createTimeFrom?: string;
  createTimeTo?: string;
  minPrice?: number;
  maxPrice?: number;
};

export type SupplierCategoryLeaf = {
  /** Provider category id - the identity discovery partitions key on. */
  categoryId: string;
  categoryName: string;
  /** Human-readable ancestry labels, display only - never identity. */
  path: string[];
};

export type WebhookTopicSetting = {
  topic: 'product' | 'stock';
  enabled: boolean;
};

export interface SupplierProviderAdapter {
  verifyConnection(connectionId: string): Promise<ConnectionHealth>;

  listCandidates(
    connectionId: string,
    input: CandidateListInput,
  ): Promise<CandidatePage>;

  /**
   * Deterministic full-catalogue discovery page: legacy `/product/list`
   * only, `orderBy=createAt` with one fixed documented sort direction.
   * Never `product/listV2`, and no result-cap assumption of any kind.
   */
  listCatalogPage(
    connectionId: string,
    query: CatalogPageQuery,
  ): Promise<CatalogPage>;

  /**
   * Curated discovery page (CJ Trending / Most listed / New arrivals). Uses
   * the SAME legacy `/product/list` endpoint and therefore the same
   * documented 50-point cost - a curated lane is an ordinary list request
   * with ranking parameters, not a separately charged operation.
   */
  listCuratedPage(
    connectionId: string,
    query: CuratedPageQuery,
  ): Promise<CatalogPage>;

  /** Current provider category tree flattened to leaf categories. */
  getCategoryTree(connectionId: string): Promise<SupplierCategoryLeaf[]>;

  getCandidateEvidence(
    connectionId: string,
    externalProductId: string,
  ): Promise<CandidateEvidence>;

  /**
   * Explicit product-id subscription (documented max 100 ids per request).
   * `subscribeAll` is never used - CJ documents it as unavailable to all
   * users after July 2026.
   */
  subscribeProducts(
    connectionId: string,
    externalProductIds: string[],
  ): Promise<void>;

  unsubscribeProducts(
    connectionId: string,
    externalProductIds: string[],
  ): Promise<void>;

  /** Enable/cancel webhook topics for one HTTPS callback URL. */
  setWebhookCallback(
    connectionId: string,
    input: { callbackUrl: string; topics: WebhookTopicSetting[] },
  ): Promise<void>;
}
