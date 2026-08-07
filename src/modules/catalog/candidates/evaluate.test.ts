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

vi.mock('@/services/cj/enrichment', () => ({ default: vi.fn() }));

// eslint-disable-next-line import/first
import fetchCandidateEvidence from '@/services/cj/enrichment';
// eslint-disable-next-line import/first
import { CjApiError } from '@/services/cj/config';
// eslint-disable-next-line import/first
import type {
  CandidateEvaluationRow,
  SupplierCandidateRow,
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
  intendedSellerId: 'seller-001',
  intendedMarketCodes: ['PH'],
  shortlistState: 'SHORTLISTED',
  createdAt: new Date(),
  createdBy: 'system:cj-ingestion',
  updatedAt: new Date(),
};

function row(
  overrides: Partial<CandidateEvaluationRow>,
): CandidateEvaluationRow {
  return {
    id: 'eval-1',
    candidateId: 'candidate-1',
    status: 'EVALUATING',
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
    asMock(fetchCandidateEvidence).mockReset();
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

    expect(fetchCandidateEvidence).not.toHaveBeenCalled();
    expect(recordScreeningDecision).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        candidateId: 'candidate-1',
        decision: expect.objectContaining({ status: 'BLOCKED' }),
      }),
    );
  });

  it('schedules a retry on a CJ fetch failure, never fabricating a decision', async () => {
    asMock(fetchCandidateEvidence).mockRejectedValue(
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
    asMock(fetchCandidateEvidence).mockRejectedValue(
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

  it('persists both the snapshot and the decision for a survivor', async () => {
    asMock(fetchCandidateEvidence).mockResolvedValue(CLEAN_EVIDENCE);

    await evaluateCandidate(row({}));

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
