import getDb from '@/lib/db/client';
import {
  cjCommentsResponseSchema,
  cjInventoryResponseSchema,
  cjProductDetailResponseSchema,
} from '@/lib/cj/enrichment-schemas';
import toCandidateEvidence, { type CandidateEvidence } from '@/lib/cj/evidence';
import { normalizeCjProduct } from '@/lib/cj/normalize';
import { cjProductListSchema } from '@/lib/cj/schemas';
import { CJ_BASE_URL, CJ_PAGE_SIZE, CjApiError } from '@/services/cj/config';
import type { SupplierSecretStore } from '@/lib/secrets/supplier-secret-store';
import { updateConnectionHealth } from '../../repository';
import type {
  CandidateListInput,
  CandidatePage,
  ConnectionHealth,
  SupplierProviderAdapter,
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

  // eslint-disable-next-line class-methods-use-this
  async subscribeProducts(): Promise<void> {
    throw new Error(
      'subscribeProducts is not implemented: no CJ webhook/subscription endpoint has been verified against the live API.',
    );
  }
}
