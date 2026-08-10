import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  default: () => ({
    transaction: (run: (tx: unknown) => Promise<unknown>) => run({ tx: true }),
  }),
  isDatabaseConfigured: () => true,
}));

vi.mock('./repository', () => ({
  appendAuditEvent: vi.fn(),
  findCandidateById: vi.fn(),
  recordEvaluationDecision: vi.fn(),
  recordEvaluationFailure: vi.fn(),
  recordScreeningDecision: vi.fn(),
  upsertSnapshot: vi.fn(),
}));

vi.mock('@/modules/suppliers/repository', () => ({
  findConnectionById: vi.fn(),
  isWorkableConnectionStatus: (status: string) =>
    status === 'CONNECTED' || status === 'DEGRADED',
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

const { getCandidateEvidenceMock } = vi.hoisted(() => ({
  getCandidateEvidenceMock: vi.fn(),
}));

vi.mock('@/modules/suppliers/providers/cj/cj-adapter', () => ({
  // eslint-disable-next-line prefer-arrow-callback
  default: vi.fn().mockImplementation(function MockCjSupplierAdapter() {
    return { getCandidateEvidence: getCandidateEvidenceMock };
  }),
}));

// eslint-disable-next-line import/first
import { CjApiError } from '@/services/cj/config';
// eslint-disable-next-line import/first
import { findConnectionById } from '@/modules/suppliers/repository';
// eslint-disable-next-line import/first
import type {
  CandidateEvaluationRow,
  SupplierCandidateRow,
  SupplierConnectionRow,
} from '@/lib/db/schema';
// eslint-disable-next-line import/first
import {
  appendAuditEvent,
  findCandidateById,
  recordEvaluationDecision,
  recordEvaluationFailure,
  recordScreeningDecision,
  upsertSnapshot,
} from './repository';
// eslint-disable-next-line import/first
import evaluateCandidate from './evaluate';
// eslint-disable-next-line import/first
import { MAX_EVALUATION_ATTEMPTS } from './rules/policy';

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const CANDIDATE: SupplierCandidateRow = {
  id: 'candidate-1',
  supplier: 'CJ_DROPSHIPPING',
  externalProductId: 'CJLY1',
  supplierConnectionId: 'connection-1',
  intendedSellerId: 'seller-account-1',
  intendedMarketCodes: ['PH'],
  shortlistState: 'SHORTLISTED',
  createdAt: new Date(),
  createdBy: 'system:cj-ingestion',
  updatedAt: new Date(),
};

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

function row(
  overrides: Partial<CandidateEvaluationRow>,
): CandidateEvaluationRow {
  return {
    id: 'eval-1',
    candidateId: 'candidate-1',
    status: 'EVALUATING',
    admissionReason: null,
    reasonCodes: [],
    evidenceSummary: null,
    sourceSnapshotChecksum: null,
    policyVersion: 'catalog-eval-policy-placeholder-v1',
    score: null,
    lastKnownPriceUsdCents: null,
    lastSeenFingerprint: 'fingerprint-1',
    feedSnapshot: {
      name: 'Plain phone case',
      category: 'Phone accessories',
      priceUsdCents: 500,
      listedCount: 10,
      shipsFrom: ['CN'],
    },
    leasedBy: 'worker-1',
    leasedUntil: new Date(),
    attemptCount: 0,
    lastErrorCode: null,
    nextRetryAt: null,
    evaluatedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const CLEAN_EVIDENCE = {
  externalProductId: 'CJLY1',
  name: 'Plain phone case',
  supplierSku: 'SKU-1',
  categoryName: 'Phone accessories',
  entryCode: '3926909090',
  supplierPriceUsd: 5,
  packedWeight: '100',
  sourceStatusRaw: '3',
  isTestProduct: false,
  listedCount: 10,
  usableImageCount: 3,
  variants: [
    {
      vid: 'v1',
      sku: 'v1-sku',
      optionLabel: 'Black',
      priceUsd: 5,
      weightGrams: 100,
      totalInventory: 10,
    },
  ],
  warehouses: [
    { countryCode: 'CN', name: 'China warehouse', totalInventory: 10 },
  ],
  reviews: { totalCount: 5, sampledCount: 5, sampledAverageScore: 4.5 },
  capturedAt: new Date('2026-08-07T00:00:00Z').toISOString(),
};

describe('evaluateCandidate', () => {
  beforeEach(() => {
    asMock(findCandidateById).mockReset().mockResolvedValue(CANDIDATE);
    asMock(findConnectionById).mockReset().mockResolvedValue(CONNECTION);
    getCandidateEvidenceMock.mockReset();
    asMock(recordScreeningDecision).mockReset().mockResolvedValue(undefined);
    asMock(recordEvaluationDecision).mockReset().mockResolvedValue(undefined);
    asMock(recordEvaluationFailure).mockReset().mockResolvedValue(undefined);
    asMock(upsertSnapshot).mockReset().mockResolvedValue(undefined);
    asMock(appendAuditEvent).mockReset().mockResolvedValue(undefined);
  });

  it('decides at the screening stage without ever calling CJ (saves evidence-fetch points)', async () => {
    await evaluateCandidate(
      row({
        feedSnapshot: {
          name: 'Tobacco pipe',
          category: 'Tobacco',
          priceUsdCents: 500,
          listedCount: 1,
          shipsFrom: [],
        },
      }),
    );

    expect(getCandidateEvidenceMock).not.toHaveBeenCalled();
    expect(recordScreeningDecision).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        candidateId: 'candidate-1',
        decision: expect.objectContaining({ status: 'BLOCKED' }),
      }),
    );
  });

  it('fails safely when the candidate has no supplier connection', async () => {
    asMock(findCandidateById).mockResolvedValue({
      ...CANDIDATE,
      supplierConnectionId: null,
    });

    await evaluateCandidate(row({}));

    expect(getCandidateEvidenceMock).not.toHaveBeenCalled();
    expect(recordEvaluationFailure).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ lastErrorCode: 'no_supplier_connection' }),
    );
  });

  it('fails safely when the connection object itself is missing (dangling reference)', async () => {
    asMock(findConnectionById).mockResolvedValue(null);

    await evaluateCandidate(row({ attemptCount: 0 }));

    expect(getCandidateEvidenceMock).not.toHaveBeenCalled();
    expect(recordEvaluationFailure).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        // A genuine data anomaly, not a seller-caused pause - still burns a
        // technical attempt like any other unexpected failure.
        attemptCount: 1,
        lastErrorCode: 'connection_unavailable',
      }),
    );
  });

  it.each([
    ['DISCONNECTED', 'SUPPLIER_CONNECTION_DISCONNECTED'],
    ['REVOKED', 'SUPPLIER_CONNECTION_REVOKED'],
    ['REAUTH_REQUIRED', 'SUPPLIER_CONNECTION_REAUTH_REQUIRED'],
    ['PENDING', 'SUPPLIER_CONNECTION_PENDING'],
  ] as const)(
    'pauses without a technical attempt or CJ call when the connection is %s',
    async (status, expectedErrorCode) => {
      asMock(findConnectionById).mockResolvedValue({
        ...CONNECTION,
        status,
      });

      await evaluateCandidate(row({ attemptCount: 2 }));

      expect(getCandidateEvidenceMock).not.toHaveBeenCalled();
      expect(recordEvaluationFailure).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          // Never incremented - the candidate did nothing wrong, and
          // recovery is event-driven (reconnect), not a backoff clock.
          attemptCount: 2,
          lastErrorCode: expectedErrorCode,
          nextRetryAt: null,
        }),
      );
      expect(appendAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: 'CANDIDATE_EVALUATION_PAUSED_CONNECTION_UNAVAILABLE',
          payload: expect.objectContaining({
            connectionStatus: status,
            lastErrorCode: expectedErrorCode,
          }),
        }),
      );
    },
  );

  it('still evaluates through a DEGRADED connection (stays workable by design)', async () => {
    asMock(findConnectionById).mockResolvedValue({
      ...CONNECTION,
      status: 'DEGRADED',
    });
    getCandidateEvidenceMock.mockResolvedValue(CLEAN_EVIDENCE);

    await evaluateCandidate(row({}));

    expect(getCandidateEvidenceMock).toHaveBeenCalled();
    expect(recordEvaluationFailure).not.toHaveBeenCalled();
  });

  it('schedules a retry on a CJ fetch failure, never fabricating a decision', async () => {
    getCandidateEvidenceMock.mockRejectedValue(
      new CjApiError('upstream-unavailable'),
    );

    await evaluateCandidate(row({ attemptCount: 0 }));

    expect(recordEvaluationFailure).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        candidateId: 'candidate-1',
        attemptCount: 1,
        lastErrorCode: 'upstream-unavailable',
        nextRetryAt: expect.any(Date),
      }),
    );
    expect(recordEvaluationDecision).not.toHaveBeenCalled();
  });

  it('dead-letters once the max attempt count is reached (nextRetryAt is null)', async () => {
    getCandidateEvidenceMock.mockRejectedValue(
      new CjApiError('upstream-unavailable'),
    );

    await evaluateCandidate(row({ attemptCount: MAX_EVALUATION_ATTEMPTS - 1 }));

    expect(recordEvaluationFailure).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        attemptCount: MAX_EVALUATION_ATTEMPTS,
        nextRetryAt: null,
      }),
    );
  });

  it("persists both the snapshot and the decision for a survivor, fetched through the candidate's own connection", async () => {
    getCandidateEvidenceMock.mockResolvedValue(CLEAN_EVIDENCE);

    await evaluateCandidate(row({}));

    expect(getCandidateEvidenceMock).toHaveBeenCalledWith(
      'connection-1',
      'CJLY1',
    );
    expect(upsertSnapshot).toHaveBeenCalled();
    expect(recordEvaluationDecision).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        candidateId: 'candidate-1',
        decision: { status: 'PASS', reasonCodes: [] },
      }),
    );
  });
});
