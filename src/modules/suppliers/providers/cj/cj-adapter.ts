import getDb from '@/lib/db/client';
import {
  cjCommentsResponseSchema,
  cjInventoryResponseSchema,
  cjProductDetailResponseSchema,
} from '@/lib/cj/enrichment-schemas';
import {
  cjCategoryTreeResponseSchema,
  cjWebhookMutationResponseSchema,
} from '@/lib/cj/discovery-schemas';
import toCandidateEvidence, { type CandidateEvidence } from '@/lib/cj/evidence';
import { normalizeCjProduct } from '@/lib/cj/normalize';
import { cjProductListSchema } from '@/lib/cj/schemas';
import { CJ_BASE_URL, CJ_PAGE_SIZE, CjApiError } from '@/services/cj/config';
import type { SupplierSecretStore } from '@/lib/secrets/supplier-secret-store';
import { updateConnectionHealth } from '../../repository';
import type {
  CandidateListInput,
  CandidatePage,
  CatalogPage,
  CatalogPageQuery,
  ConnectionHealth,
  CuratedPageQuery,
  SupplierCategoryLeaf,
  SupplierProviderAdapter,
  WebhookTopicSetting,
} from '../../contracts';
import CjTokenManager from './cj-auth';

/**
 * CJ implementation of `SupplierProviderAdapter`. Deliberately re-fetches
 * CJ directly here (rather than reusing `services/cj/{products,
 * enrichment}.ts`) instead of threading a per-connection token override
 * through those functions' portal-session-bound `requirePermission` calls,
 * which belong at the Server Action/page boundary, not inside a
 * provider-agnostic adapter used by both seller-facing code and the
 * system automation pipeline. The schema/normalisation layer
 * (`lib/cj/*`) - the part that actually encodes CJ's real, verified
 * response shape - is reused unchanged.
 *
 * CJ's one-request-per-second limit applies per connection, not globally -
 * see `cj-auth.ts`'s per-connection token cache for the same reasoning.
 */

const REQUEST_SPACING_MS = 1_100;
const COMMENT_SAMPLE_SIZE = 20;
/** Documented legacy `/product/list` per-page maximum. */
const CATALOG_PAGE_SIZE_MAX = 200;
/** Documented maximum product ids per webhook subscribe/unsubscribe request. */
const SUBSCRIPTION_BATCH_MAX = 100;
/**
 * Fixed deterministic discovery ordering: documented `orderBy` values are
 * `createAt` and `listedNum`; discovery always uses `createAt` ascending so
 * repeated enumerations of an immutable time window walk the same sequence.
 */
const CATALOG_ORDER_BY = 'createAt';
const CATALOG_SORT = 'asc';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export type FetchImpl = typeof fetch;

export default class CjSupplierAdapter implements SupplierProviderAdapter {
  constructor(
    // Not read directly today - token refresh/read already goes through
    // `tokenManager`, which holds its own secret store internally. Kept as
    // an explicit constructor dependency to match this adapter's DI
    // contract for any future method that needs the raw credential bundle
    // (e.g. re-deriving `externalAccountMasked` after a reconnect).
    private readonly secretStore: SupplierSecretStore,
    private readonly tokenManager: CjTokenManager,
    private readonly fetchImpl: FetchImpl = fetch,
  ) {}

  private async getJson(connectionId: string, path: string): Promise<unknown> {
    const token = await this.tokenManager.getAccessToken(connectionId);
    const response = await this.fetchImpl(`${CJ_BASE_URL}${path}`, {
      headers: { 'CJ-Access-Token': token },
      cache: 'no-store',
    });

    if (response.status === 429) throw new CjApiError('rate-limited');
    if (!response.ok) throw new CjApiError('upstream-unavailable');

    return response.json();
  }

  private async postJson(
    connectionId: string,
    path: string,
    body: unknown,
  ): Promise<unknown> {
    const token = await this.tokenManager.getAccessToken(connectionId);
    const response = await this.fetchImpl(`${CJ_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'CJ-Access-Token': token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });

    if (response.status === 429) throw new CjApiError('rate-limited');
    if (!response.ok) throw new CjApiError('upstream-unavailable');

    return response.json();
  }

  async verifyConnection(connectionId: string): Promise<ConnectionHealth> {
    try {
      await this.tokenManager.getAccessToken(connectionId);

      const health: ConnectionHealth = {
        status: 'CONNECTED',
        lastVerifiedAt: new Date(),
        lastErrorCode: null,
      };

      await updateConnectionHealth(getDb(), connectionId, {
        status: health.status,
        lastVerifiedAt: health.lastVerifiedAt,
        lastErrorCode: null,
      });

      return health;
    } catch (error) {
      const reason =
        error instanceof CjApiError ? error.reason : 'unexpected-response';
      const status =
        reason === 'authentication-failed' ? 'REAUTH_REQUIRED' : 'DEGRADED';

      await updateConnectionHealth(getDb(), connectionId, {
        status,
        lastErrorCode: reason,
      });

      return { status, lastVerifiedAt: new Date(), lastErrorCode: reason };
    }
  }

  async listCandidates(
    connectionId: string,
    input: CandidateListInput,
  ): Promise<CandidatePage> {
    const params = new URLSearchParams({
      pageNum: String(input.page),
      pageSize: String(CJ_PAGE_SIZE),
    });

    if (input.search !== '') params.set('productNameEn', input.search);
    if (input.pid !== '') params.set('pid', input.pid);

    const parsed = cjProductListSchema.safeParse(
      await this.getJson(connectionId, `/product/list?${params.toString()}`),
    );

    if (!parsed.success) throw new CjApiError('unexpected-response');
    if (parsed.data.code !== 200) {
      throw new CjApiError(
        parsed.data.code === 401
          ? 'authentication-failed'
          : 'unexpected-response',
      );
    }

    const data = parsed.data.data ?? null;
    const total = data?.total ?? 0;
    const pageSize = data?.pageSize ?? CJ_PAGE_SIZE;

    return {
      products: (data?.list ?? []).map(normalizeCjProduct),
      page: data?.pageNum ?? input.page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / Math.max(pageSize, 1))),
    };
  }

  async getCandidateEvidence(
    connectionId: string,
    externalProductId: string,
  ): Promise<CandidateEvidence> {
    const detailParsed = cjProductDetailResponseSchema.safeParse(
      await this.getJson(
        connectionId,
        `/product/query?pid=${encodeURIComponent(externalProductId)}`,
      ),
    );

    if (!detailParsed.success) throw new CjApiError('unexpected-response');
    if (detailParsed.data.code !== 200 || !detailParsed.data.data) {
      throw new CjApiError(
        detailParsed.data.code === 401
          ? 'authentication-failed'
          : 'unexpected-response',
      );
    }

    await delay(REQUEST_SPACING_MS);

    const inventoryParsed = cjInventoryResponseSchema.safeParse(
      await this.getJson(
        connectionId,
        `/product/stock/getInventoryByPid?pid=${encodeURIComponent(externalProductId)}`,
      ),
    );

    if (!inventoryParsed.success) throw new CjApiError('unexpected-response');

    await delay(REQUEST_SPACING_MS);

    const commentsParsed = cjCommentsResponseSchema.safeParse(
      await this.getJson(
        connectionId,
        `/product/productComments?pid=${encodeURIComponent(externalProductId)}&pageNum=1&pageSize=${COMMENT_SAMPLE_SIZE}`,
      ),
    );

    if (!commentsParsed.success) throw new CjApiError('unexpected-response');

    return toCandidateEvidence({
      detail: detailParsed.data.data,
      warehouseInventories: inventoryParsed.data.data?.inventories ?? [],
      variantInventories: inventoryParsed.data.data?.variantInventories ?? [],
      reviewTotal: commentsParsed.data.data?.total ?? 0,
      comments: commentsParsed.data.data?.list ?? [],
      capturedAt: new Date(),
    });
  }

  /**
   * Legacy full-catalogue discovery page. Only documented legacy filters are
   * sent; ordering is pinned to `orderBy=createAt&sort=asc` so an immutable
   * partition enumerates deterministically. `totalPages` is derived from the
   * provider's own reported `total`/`pageSize` because the legacy envelope
   * carries no totalPages field. NO result-cap constant exists here: a total
   * of exactly 6,000 or more is ordinary density data for the partitioner.
   */
  async listCatalogPage(
    connectionId: string,
    query: CatalogPageQuery,
  ): Promise<CatalogPage> {
    if (
      !Number.isInteger(query.pageNum) ||
      query.pageNum < 1 ||
      !Number.isInteger(query.pageSize) ||
      query.pageSize < 1 ||
      query.pageSize > CATALOG_PAGE_SIZE_MAX
    ) {
      throw new CjApiError('unexpected-response');
    }

    const params = new URLSearchParams({
      pageNum: String(query.pageNum),
      pageSize: String(query.pageSize),
      orderBy: CATALOG_ORDER_BY,
      sort: CATALOG_SORT,
    });

    if (query.categoryId !== undefined && query.categoryId !== '') {
      params.set('categoryId', query.categoryId);
    }
    if (query.createTimeFrom !== undefined) {
      params.set('createTimeFrom', query.createTimeFrom);
    }
    if (query.createTimeTo !== undefined) {
      params.set('createTimeTo', query.createTimeTo);
    }
    if (query.minPrice !== undefined) {
      params.set('minPrice', query.minPrice.toFixed(2));
    }
    if (query.maxPrice !== undefined) {
      params.set('maxPrice', query.maxPrice.toFixed(2));
    }

    const parsed = cjProductListSchema.safeParse(
      await this.getJson(connectionId, `/product/list?${params.toString()}`),
    );

    if (!parsed.success) throw new CjApiError('unexpected-response');
    if (parsed.data.code !== 200) {
      throw new CjApiError(
        parsed.data.code === 401
          ? 'authentication-failed'
          : 'unexpected-response',
      );
    }

    const data = parsed.data.data ?? null;
    const total = data?.total ?? 0;
    const pageSize = data?.pageSize ?? query.pageSize;

    return {
      products: (data?.list ?? []).map(normalizeCjProduct),
      requestedPageNum: query.pageNum,
      pageNum: data?.pageNum ?? -1,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / Math.max(pageSize, 1))),
      pointsInfo: parsed.data.pointsInfo ?? null,
    };
  }

  /**
   * Curated discovery page (CJ Trending / Most listed / New arrivals).
   *
   * Same legacy `/product/list` endpoint, same documented 50-point cost, and
   * the same tolerant schema/normalisation as every other list read - only
   * the ranking parameters differ. There is deliberately no separate
   * "curated" provider route, no `product/listV2` call, and no result-cap
   * constant: a curated lane is intentionally a SUBSET of the catalogue and
   * proves nothing about coverage.
   */
  async listCuratedPage(
    connectionId: string,
    query: CuratedPageQuery,
  ): Promise<CatalogPage> {
    if (
      !Number.isInteger(query.pageNum) ||
      query.pageNum < 1 ||
      !Number.isInteger(query.pageSize) ||
      query.pageSize < 1 ||
      query.pageSize > CATALOG_PAGE_SIZE_MAX
    ) {
      throw new CjApiError('unexpected-response');
    }

    const params = new URLSearchParams({
      pageNum: String(query.pageNum),
      pageSize: String(query.pageSize),
    });

    if (query.searchType !== undefined) {
      params.set('searchType', String(query.searchType));
    }
    if (query.orderBy !== undefined) params.set('orderBy', query.orderBy);
    if (query.sort !== undefined) params.set('sort', query.sort);
    if (query.categoryId !== undefined && query.categoryId !== '') {
      params.set('categoryId', query.categoryId);
    }
    if (query.createTimeFrom !== undefined) {
      params.set('createTimeFrom', query.createTimeFrom);
    }
    if (query.createTimeTo !== undefined) {
      params.set('createTimeTo', query.createTimeTo);
    }
    if (query.minPrice !== undefined) {
      params.set('minPrice', query.minPrice.toFixed(2));
    }
    if (query.maxPrice !== undefined) {
      params.set('maxPrice', query.maxPrice.toFixed(2));
    }

    const parsed = cjProductListSchema.safeParse(
      await this.getJson(connectionId, `/product/list?${params.toString()}`),
    );

    if (!parsed.success) throw new CjApiError('unexpected-response');
    if (parsed.data.code !== 200) {
      throw new CjApiError(
        parsed.data.code === 401
          ? 'authentication-failed'
          : 'unexpected-response',
      );
    }

    const data = parsed.data.data ?? null;
    const total = data?.total ?? 0;
    const pageSize = data?.pageSize ?? query.pageSize;

    return {
      products: (data?.list ?? []).map(normalizeCjProduct),
      requestedPageNum: query.pageNum,
      pageNum: data?.pageNum ?? -1,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / Math.max(pageSize, 1))),
      pointsInfo: parsed.data.pointsInfo ?? null,
    };
  }

  /**
   * Flattens the documented three-level `GET /product/getCategory` tree to
   * leaf categories. Leaves with no usable provider id are dropped - a
   * label is never a category identity.
   */
  async getCategoryTree(connectionId: string): Promise<SupplierCategoryLeaf[]> {
    const parsed = cjCategoryTreeResponseSchema.safeParse(
      await this.getJson(connectionId, '/product/getCategory'),
    );

    if (!parsed.success) throw new CjApiError('unexpected-response');
    if (parsed.data.code !== 200) {
      throw new CjApiError(
        parsed.data.code === 401
          ? 'authentication-failed'
          : 'unexpected-response',
      );
    }

    const leaves: SupplierCategoryLeaf[] = [];

    (parsed.data.data ?? []).forEach((first) => {
      (first.categoryFirstList ?? []).forEach((second) => {
        (second.categorySecondList ?? []).forEach((third) => {
          if (third.categoryId !== '') {
            leaves.push({
              categoryId: third.categoryId,
              categoryName: third.categoryName,
              path: [first.categoryFirstName, second.categorySecondName],
            });
          }
        });
      });
    });

    return leaves;
  }

  private async webhookMutation(
    connectionId: string,
    path: string,
    body: unknown,
  ): Promise<void> {
    const parsed = cjWebhookMutationResponseSchema.safeParse(
      await this.postJson(connectionId, path, body),
    );

    if (!parsed.success) throw new CjApiError('unexpected-response');
    if (parsed.data.code !== 200) {
      throw new CjApiError(
        parsed.data.code === 401
          ? 'authentication-failed'
          : 'unexpected-response',
      );
    }
  }

  /**
   * Documented `POST /webhook/product/subscribe`, max 100 product ids per
   * request - enforced here so no caller can silently exceed the contract.
   * `subscribeAll` is never sent (unavailable to all users after July 2026).
   */
  async subscribeProducts(
    connectionId: string,
    externalProductIds: string[],
  ): Promise<void> {
    if (externalProductIds.length === 0) return;
    if (externalProductIds.length > SUBSCRIPTION_BATCH_MAX) {
      throw new CjApiError('unexpected-response');
    }

    await this.webhookMutation(connectionId, '/webhook/product/subscribe', {
      productIds: externalProductIds,
    });
  }

  /** Documented `POST /webhook/product/unsubscribe`, max 100 ids per request. */
  async unsubscribeProducts(
    connectionId: string,
    externalProductIds: string[],
  ): Promise<void> {
    if (externalProductIds.length === 0) return;
    if (externalProductIds.length > SUBSCRIPTION_BATCH_MAX) {
      throw new CjApiError('unexpected-response');
    }

    await this.webhookMutation(connectionId, '/webhook/product/unsubscribe', {
      productIds: externalProductIds,
    });
  }

  /**
   * Documented `POST /webhook/set`: per-topic ENABLE/CANCEL with exactly one
   * public HTTPS callback URL. The URL is validated here so a misconfigured
   * environment value can never point CJ at a non-HTTPS endpoint.
   */
  async setWebhookCallback(
    connectionId: string,
    input: { callbackUrl: string; topics: WebhookTopicSetting[] },
  ): Promise<void> {
    let parsedUrl: URL;

    try {
      parsedUrl = new URL(input.callbackUrl);
    } catch {
      throw new CjApiError('unexpected-response');
    }

    if (parsedUrl.protocol !== 'https:') {
      throw new CjApiError('unexpected-response');
    }

    const body = Object.fromEntries(
      input.topics.map((setting) => [
        setting.topic,
        {
          type: setting.enabled ? 'ENABLE' : 'CANCEL',
          callbackUrls: [input.callbackUrl],
        },
      ]),
    );

    await this.webhookMutation(connectionId, '/webhook/set', body);
  }
}
