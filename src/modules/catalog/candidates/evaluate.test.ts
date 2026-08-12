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
  recordEvaluationFailure: vi.fn(),
  recordScreeningDecision: vi.fn(),
}));

vi.mock('@/modules/suppliers/repository', () => ({
  findConnectionById: vi.fn(),
  isWorkableConnectionStatus: (status: string) =>
    status === 'CONNECTED' || status === 'DEGRADED',
}));

const { resolveBuyerDestinationCountryPolicyMock } = vi.hoisted(() => ({
  resolveBuyerDestinationCountryPolicyMock: vi.fn(),
}));

vi.mock('@/lib/country-policy/buyer-destination-country', () => ({
  default: resolveBuyerDestinationCountryPolicyMock,
}));

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
  recordEvaluationFailure,
  recordScreeningDecision,
} from './repository';
// eslint-disable-next-line import/first
import evaluateCandidate from './evaluate';
// eslint-disable-next-line import/first
import { composeEvaluationPolicyVersion, POLICY_VERSION } from './rules/policy';

/**
 * Lean intake policy (ADR-013 §1a): raw All Supplier Products evaluation is
 * LOCAL screening only.
 *
 * The load-bearing assertion in this suite is a negative one, and it is
 * enforced structurally rather than by mocking the supplier client away: no
 * supplier adapter, token manager, or secret store is mocked here at all, so
 * if `evaluate.ts` ever reintroduces an evidence fetch, these tests fail on a
 * real unmocked import rather than silently passing against a stub.
 */

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const CANDIDATE: SupplierCandidateRow = {
  id: 'candidate-1',
  supplier: 'CJ_DROPSHIPPING',
  externalProductId: 'CJLY1',
  supplierConnectionId: 'connection-1',
  intendedSellerId: 'seller-account-1',
  intendedMarketCodes: ['TEST'],
  shortlistState: 'SHORTLISTED',
  providerCategoryId: 'cat-1',
  providerCategoryName: 'Home',
  stockReviewState: 'STOCK_NOT_CHECKED',
  stockReviewVersion: 0,
  stockReviewObservedAt: null,
  stockReviewRecordedAt: null,
  stockReviewActorId: null,
  stockReviewObservedQuantity: null,
  stockReviewObservedOrigin: null,
  stockReviewNote: null,
  providerLastSeenAt: null,
  providerLastVerifiedAt: null,
  providerRemovalSuspectedAt: null,
  providerRemovalConfirmedAt: null,
  createdAt: new Date(),
  createdBy: 'system:cj-discovery',
  updatedAt: new Date(),
};

const CONNECTION = {
  id: 'connection-1',
  status: 'CONNECTED',
  sellerAccountId: 'seller-account-1',
} as unknown as SupplierConnectionRow;

function evaluationRow(
  overrides: Partial<CandidateEvaluationRow> = {},
): CandidateEvaluationRow {
  return {
    id: 'evaluation-1',
    candidateId: 'candidate-1',
    status: 'QUEUED',
    admissionReason: 'NEW_PRODUCT',
    reasonCodes: [],
    evidenceSummary: null,
    sourceSnapshotChecksum: null,
    policyVersion: POLICY_VERSION,
    score: null,
    lastKnownPriceUsdCents: null,
    lastSeenFingerprint: 'fingerprint-1',
    feedSnapshot: {
      name: 'Ceramic mug',
      category: 'Home & Kitchen',
      priceUsdCents: 1_250,
      listedCount: 12,
      shipsFrom: ['CN'],
    },
    leasedBy: null,
    leasedUntil: null,
    attemptCount: 0,
    lastErrorCode: null,
    nextRetryAt: null,
    nextRefreshAt: null,
    evaluatedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as CandidateEvaluationRow;
}

beforeEach(() => {
  vi.clearAllMocks();
  asMock(findCandidateById).mockResolvedValue(CANDIDATE);
  asMock(findConnectionById).mockResolvedValue(CONNECTION);
  resolveBuyerDestinationCountryPolicyMock.mockReturnValue({
    countryCodes: ['TEST'],
    effective: 'ENABLED',
    policyVersion: 'buyer-destination-test-v1',
    source: 'test',
  });
});

describe('evaluateCandidate under the lean intake policy', () => {
  it('decides from the persisted feed summary alone and records a screening-only decision', async () => {
    await evaluateCandidate(evaluationRow());

    expect(asMock(recordScreeningDecision)).toHaveBeenCalledTimes(1);

    const [, decisionInput] = asMock(recordScreeningDecision).mock.calls[0];

    expect(decisionInput.decision.status).toBe('PASS');
    expect(decisionInput.policyVersion).toBe(
      composeEvaluationPolicyVersion(
        POLICY_VERSION,
        'buyer-destination-test-v1',
      ),
    );
  });

  it('audits the decision as screening-only with no supplier evidence fetched', async () => {
    await evaluateCandidate(evaluationRow());

    const [, auditInput] = asMock(appendAuditEvent).mock.calls[0];

    expect(auditInput.action).toBe('CANDIDATE_SCREENING_DECIDED');
    expect(auditInput.payload.screeningOnly).toBe(true);
    expect(auditInput.payload.supplierEvidenceFetched).toBe(false);
  });

  it('blocks on a screening rule without any supplier call', async () => {
    await evaluateCandidate(
      evaluationRow({
        feedSnapshot: {
          name: 'Nike running shoe replica',
          category: 'Shoes',
          priceUsdCents: 3_000,
          listedCount: 4,
          shipsFrom: ['CN'],
        },
      } as Partial<CandidateEvaluationRow>),
    );

    const [, decisionInput] = asMock(recordScreeningDecision).mock.calls[0];

    expect(decisionInput.decision.status).toBe('BLOCKED');
    expect(decisionInput.decision.reasonCodes).toContain(
      'COUNTERFEIT_HIGH_CONFIDENCE',
    );
  });

  it('fails closed with NO_VALID_MARKET when no buyer destination is enabled', async () => {
    resolveBuyerDestinationCountryPolicyMock.mockReturnValue({
      countryCodes: [],
      effective: 'DISABLED',
      policyVersion: 'buyer-destination-disabled-v1',
      source: 'test',
    });

    await evaluateCandidate(evaluationRow());

    const [, decisionInput] = asMock(recordScreeningDecision).mock.calls[0];

    expect(decisionInput.decision.reasonCodes).toContain('NO_VALID_MARKET');
    expect(decisionInput.decision.status).toBe('TEMPORARILY_INELIGIBLE');
  });

  it('pauses without burning an attempt when the seller disconnected their connection', async () => {
    asMock(findConnectionById).mockResolvedValue({
      ...CONNECTION,
      status: 'DISCONNECTED',
    });

    await evaluateCandidate(evaluationRow({ attemptCount: 2 }));

    expect(asMock(recordScreeningDecision)).not.toHaveBeenCalled();

    const [, failureInput] = asMock(recordEvaluationFailure).mock.calls[0];

    expect(failureInput.attemptCount).toBe(2);
    expect(failureInput.nextRetryAt).toBeNull();
  });

  it('does nothing when the candidate row is gone', async () => {
    asMock(findCandidateById).mockResolvedValue(null);

    await evaluateCandidate(evaluationRow());

    expect(asMock(recordScreeningDecision)).not.toHaveBeenCalled();
    expect(asMock(recordEvaluationFailure)).not.toHaveBeenCalled();
  });
});
