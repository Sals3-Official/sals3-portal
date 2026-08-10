import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  default: () => ({
    transaction: (run: (tx: unknown) => Promise<unknown>) => run({ tx: true }),
  }),
  isDatabaseConfigured: () => true,
}));

vi.mock('@/modules/suppliers/repository', () => ({
  listWorkableConnections: vi.fn(),
}));

vi.mock('@/lib/secrets/postgres-supplier-secret-store', () => ({
  // A real `function` is required, not an arrow function - the code under
  // test calls `new PostgresSupplierSecretStore()`, and arrow functions can
  // never be constructors.
  // eslint-disable-next-line prefer-arrow-callback
  default: vi.fn().mockImplementation(function MockClass() {
    return {};
  }),
}));

vi.mock('@/modules/suppliers/providers/cj/cj-auth', () => ({
  // eslint-disable-next-line prefer-arrow-callback
  default: vi.fn().mockImplementation(function MockClass() {
    return {};
  }),
}));

const { listCandidatesMock } = vi.hoisted(() => ({
  listCandidatesMock: vi.fn(),
}));

vi.mock('@/modules/suppliers/providers/cj/cj-adapter', () => ({
  // eslint-disable-next-line prefer-arrow-callback
  default: vi.fn().mockImplementation(function MockCjSupplierAdapter() {
    return { listCandidates: listCandidatesMock };
  }),
}));

vi.mock('./repository', () => ({
  insertCandidateIfAbsent: vi.fn(),
  findCandidateByConnectionAndExternalId: vi.fn(),
  insertQueuedEvaluationIfAbsent: vi.fn(),
  requeueIfFingerprintChanged: vi.fn(),
}));

// eslint-disable-next-line import/first
import { listWorkableConnections } from '@/modules/suppliers/repository';
// eslint-disable-next-line import/first
import type { CjProduct } from '@/lib/cj/normalize';
// eslint-disable-next-line import/first
import type { SupplierConnectionRow } from '@/lib/db/schema';
// eslint-disable-next-line import/first
import {
  findCandidateByConnectionAndExternalId,
  insertCandidateIfAbsent,
  insertQueuedEvaluationIfAbsent,
  requeueIfFingerprintChanged,
} from './repository';
// eslint-disable-next-line import/first
import ingestCjFeed from './ingestion';

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const CONNECTION: SupplierConnectionRow = {
  id: 'connection-1',
  sellerAccountId: 'seller-account-1',
  providerId: 'provider-1',
  displayName: 'CJ Dropshipping',
  externalAccountLookupHash: 'hash',
  externalAccountMasked: 'CJ...1234',
  status: 'CONNECTED',
  accessTokenExpiresAt: null,
  refreshTokenExpiresAt: null,
  lastVerifiedAt: null,
  lastErrorCode: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  disconnectedAt: null,
};

const PRODUCT: CjProduct = {
  id: 'CJLY1',
  name: 'Plain phone case',
  sku: 'SKU-1',
  imageUrl: null,
  category: 'Phone accessories',
  priceCentsUsd: 500,
  weight: '100 g',
  productType: 'accessory',
  supplier: 'CJ',
  freeShipping: false,
  shipsFrom: ['CN'],
  listedCount: 10,
  createdAt: null,
};

function singlePageOf(products: CjProduct[]) {
  return {
    products,
    page: 1,
    pageSize: 20,
    total: products.length,
    totalPages: 1,
  };
}

describe('ingestCjFeed', () => {
  beforeEach(() => {
    asMock(listWorkableConnections).mockReset().mockResolvedValue([CONNECTION]);
    listCandidatesMock.mockReset();
    asMock(insertCandidateIfAbsent).mockReset();
    asMock(findCandidateByConnectionAndExternalId).mockReset();
    asMock(insertQueuedEvaluationIfAbsent)
      .mockReset()
      .mockResolvedValue(undefined);
    asMock(requeueIfFingerprintChanged).mockReset().mockResolvedValue(false);
  });

  it('creates a candidate and a QUEUED evaluation for an unseen product', async () => {
    listCandidatesMock.mockResolvedValue(singlePageOf([PRODUCT]));
    asMock(insertCandidateIfAbsent).mockResolvedValue({
      id: 'candidate-1',
      shortlistState: 'SHORTLISTED',
    });

    const result = await ingestCjFeed();

    expect(insertCandidateIfAbsent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ supplierConnectionId: 'connection-1' }),
    );
    // No ADR-003 buyer destination is approved yet, and AU seller
    // registration must not leak into it - see
    // `resolveBuyerDestinationCountryPolicy()`.
    expect(insertCandidateIfAbsent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ intendedMarketCodes: [] }),
    );
    expect(insertQueuedEvaluationIfAbsent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ candidateId: 'candidate-1' }),
    );
    expect(result).toMatchObject({
      connectionsProcessed: 1,
      candidatesSeen: 1,
      candidatesCreated: 1,
      candidatesRequeued: 0,
    });
  });

  it('does not duplicate an already-ingested product, and only counts a requeue when the fingerprint actually changed', async () => {
    listCandidatesMock.mockResolvedValue(singlePageOf([PRODUCT]));
    asMock(insertCandidateIfAbsent).mockResolvedValue(null); // conflict: already exists for this connection
    asMock(findCandidateByConnectionAndExternalId).mockResolvedValue({
      id: 'candidate-1',
    });
    asMock(requeueIfFingerprintChanged).mockResolvedValue(false); // unchanged since last ingestion

    const result = await ingestCjFeed();

    expect(insertQueuedEvaluationIfAbsent).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      connectionsProcessed: 1,
      candidatesSeen: 1,
      candidatesCreated: 0,
      candidatesRequeued: 0,
    });
  });

  it('counts a requeue only when the repository reports the row actually changed', async () => {
    listCandidatesMock.mockResolvedValue(singlePageOf([PRODUCT]));
    asMock(insertCandidateIfAbsent).mockResolvedValue(null);
    asMock(findCandidateByConnectionAndExternalId).mockResolvedValue({
      id: 'candidate-1',
    });
    asMock(requeueIfFingerprintChanged).mockResolvedValue(true);

    const result = await ingestCjFeed();

    expect(result.candidatesRequeued).toBe(1);
  });

  it('stops paging once the feed reports it has reached the last page', async () => {
    listCandidatesMock.mockResolvedValue(singlePageOf([]));

    await ingestCjFeed();

    expect(listCandidatesMock).toHaveBeenCalledTimes(1);
  });

  it('processes zero connections without error when none are workable', async () => {
    asMock(listWorkableConnections).mockResolvedValue([]);

    const result = await ingestCjFeed();

    expect(listCandidatesMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ connectionsProcessed: 0, pagesFetched: 0 });
  });
});
