import type { CjProduct } from '@/lib/cj/normalize';
import type { CandidateEvidence } from '@/lib/cj/evidence';

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

export interface SupplierProviderAdapter {
  verifyConnection(connectionId: string): Promise<ConnectionHealth>;

  listCandidates(
    connectionId: string,
    input: CandidateListInput,
  ): Promise<CandidatePage>;

  getCandidateEvidence(
    connectionId: string,
    externalProductId: string,
  ): Promise<CandidateEvidence>;

  /**
   * Not wired to any caller yet. No CJ webhook/subscription endpoint has
   * been verified against the live API (only `/product/list`,
   * `/product/query`, `/product/stock/getInventoryByPid`,
   * `/product/productComments`, and `/authentication/getAccessToken` are
   * confirmed) - implementations should reject rather than fabricate a call
   * CJ was never confirmed to support.
   */
  subscribeProducts(
    connectionId: string,
    externalProductIds: string[],
  ): Promise<void>;
}
