// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CandidateEvidence } from '@/lib/cj/evidence';
import { CjApiError } from '@/services/cj/config';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  findCandidateSourceForSeller: vi.fn(),
  upsertSnapshot: vi.fn(),
  appendAuditEvent: vi.fn(),
  getCandidateEvidence: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  default: mocks.getDb,
}));

vi.mock('@/modules/catalog/products/repository', () => ({
  findCandidateSourceForSeller: mocks.findCandidateSourceForSeller,
}));

vi.mock('./repository', () => ({
  upsertSnapshot: mocks.upsertSnapshot,
  appendAuditEvent: mocks.appendAuditEvent,
}));

const captureCandidateEvidence = (await import('./capture-evidence')).default;
const { EVIDENCE_SCHEMA_VERSION } = await import('./rules/policy');

const CANDIDATE_ID = 'cb9bc366-63d6-42d5-9bd2-38384de8e5d4';
const SELLER_ID = '843af4aa-725d-4728-bc46-334582566033';

function evidence(): CandidateEvidence {
  return {
    externalProductId: '2601080506461632500',
    name: 'Mens Fleece-Lined Jacket',
    supplierSku: 'CJYD2718032',
    categoryName: "Men's Jackets",
    entryCode: '6201',
    supplierPriceUsd: 7.96,
    packedWeight: '850.00-930.00 g',
    sourceStatusRaw: '1',
    isTestProduct: false,
    listedCount: 13,
    usableImageCount: 2,
    imageUrls: [
      'https://cf.cjdropshipping.com/quick/product/a.jpg',
      'https://cf.cjdropshipping.com/quick/product/b.jpg',
    ],
    variants: [
      {
        vid: 'v1',
        sku: 'CJYD2718032-BLK-XL',
        optionLabel: 'Black-XL',
        priceUsd: 8.42,
        weightGrams: 880,
        stockByOrigin: [],
        totalInventory: 36,
        stockEvidence: 'CJ_WAREHOUSE_STOCK',
      },
    ],
    warehouses: [],
    reviews: { totalCount: 0, sampledCount: 0, sampledAverageScore: null },
    capturedAt: '2026-08-13T10:00:00.000Z',
  };
}

function source(status = 'CONNECTED') {
  return {
    candidateId: CANDIDATE_ID,
    externalProductId: '2601080506461632500',
    supplierConnectionId: '6aa82ace-e1bb-42cb-88b0-af5e0917d0f5',
    connectionStatus: status,
    supplierProviderId: '85ffcf9f-3ab8-4463-a8e5-a9c2fbace353',
    supplierProviderCode: 'CJ_DROPSHIPPING',
  };
}

function transactionalDb() {
  const update = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(undefined),
  };
  const tx = { update: vi.fn(() => update) };
  const db = {
    transaction: vi.fn(
      async (callback: (executor: unknown) => Promise<void>) => {
        await callback(tx);
      },
    ),
  };

  return { db, tx, update };
}

function deps() {
  return { adapter: { getCandidateEvidence: mocks.getCandidateEvidence } };
}

describe('captureCandidateEvidence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('persists the snapshot, refreshes the reference, and audits the capture', async () => {
    const { db, tx, update } = transactionalDb();

    mocks.getDb.mockReturnValue(db);
    mocks.findCandidateSourceForSeller.mockResolvedValue(source());
    mocks.getCandidateEvidence.mockResolvedValue(evidence());

    const result = await captureCandidateEvidence(deps() as never, {
      candidateId: CANDIDATE_ID,
      sellerAccountId: SELLER_ID,
      actorId: 'actor-1',
    });

    expect(result).toMatchObject({
      ok: true,
      variantCount: 1,
      imageCount: 2,
    });
    expect(mocks.upsertSnapshot).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        candidateId: CANDIDATE_ID,
        schemaVersion: EVIDENCE_SCHEMA_VERSION,
      }),
    );
    // `lastObservedAt` must be the observation, never `now()`: overstating
    // freshness is how a stale cost silently passes a freshness gate.
    expect(update.set).toHaveBeenCalledWith(
      expect.objectContaining({
        lastObservedAt: new Date('2026-08-13T10:00:00.000Z'),
        syncState: 'HEALTHY',
      }),
    );
    expect(mocks.appendAuditEvent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: 'catalog_candidate_evidence.captured',
      }),
    );
  });

  it('records a checksum over the evidence, not the evidence itself, in the audit row', async () => {
    const { db } = transactionalDb();

    mocks.getDb.mockReturnValue(db);
    mocks.findCandidateSourceForSeller.mockResolvedValue(source());
    mocks.getCandidateEvidence.mockResolvedValue(evidence());

    await captureCandidateEvidence(deps() as never, {
      candidateId: CANDIDATE_ID,
      sellerAccountId: SELLER_ID,
      actorId: 'actor-1',
    });

    const payload = mocks.appendAuditEvent.mock.calls[0]?.[1].payload;

    expect(payload.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(payload)).not.toContain('imageUrls');
  });

  /**
   * Tenant scope is resolved in the query, so another seller's candidate is
   * indistinguishable from a nonexistent one — and costs zero CJ points.
   */
  it('spends nothing when the candidate is not this seller’s', async () => {
    mocks.getDb.mockReturnValue(transactionalDb().db);
    mocks.findCandidateSourceForSeller.mockResolvedValue(null);

    const result = await captureCandidateEvidence(deps() as never, {
      candidateId: CANDIDATE_ID,
      sellerAccountId: SELLER_ID,
      actorId: 'actor-1',
    });

    expect(result).toEqual({ ok: false, reason: 'not_found' });
    expect(mocks.getCandidateEvidence).not.toHaveBeenCalled();
  });

  it.each(['DISCONNECTED', 'REAUTH_REQUIRED', 'REVOKED'])(
    'spends nothing on a %s connection',
    async (status) => {
      mocks.getDb.mockReturnValue(transactionalDb().db);
      mocks.findCandidateSourceForSeller.mockResolvedValue(source(status));

      const result = await captureCandidateEvidence(deps() as never, {
        candidateId: CANDIDATE_ID,
        sellerAccountId: SELLER_ID,
        actorId: 'actor-1',
      });

      expect(result).toEqual({ ok: false, reason: 'connection_unhealthy' });
      expect(mocks.getCandidateEvidence).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['rate-limited', 'rate_limited'],
    ['authentication-failed', 'connection_unhealthy'],
    ['missing-credentials', 'connection_unhealthy'],
    ['upstream-unavailable', 'supplier_unavailable'],
  ])('maps a %s supplier failure to %s', async (reason, expected) => {
    mocks.getDb.mockReturnValue(transactionalDb().db);
    mocks.findCandidateSourceForSeller.mockResolvedValue(source());
    mocks.getCandidateEvidence.mockRejectedValue(
      new CjApiError(reason as never),
    );

    const result = await captureCandidateEvidence(deps() as never, {
      candidateId: CANDIDATE_ID,
      sellerAccountId: SELLER_ID,
      actorId: 'actor-1',
    });

    expect(result).toEqual({ ok: false, reason: expected });
    expect(mocks.upsertSnapshot).not.toHaveBeenCalled();
  });

  it('writes nothing at all when the supplier call fails', async () => {
    const { db } = transactionalDb();

    mocks.getDb.mockReturnValue(db);
    mocks.findCandidateSourceForSeller.mockResolvedValue(source());
    mocks.getCandidateEvidence.mockRejectedValue(new Error('socket hang up'));

    await captureCandidateEvidence(deps() as never, {
      candidateId: CANDIDATE_ID,
      sellerAccountId: SELLER_ID,
      actorId: 'actor-1',
    });

    expect(db.transaction).not.toHaveBeenCalled();
    expect(mocks.appendAuditEvent).not.toHaveBeenCalled();
  });
});
