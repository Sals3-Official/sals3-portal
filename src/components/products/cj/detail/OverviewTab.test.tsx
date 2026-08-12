import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CandidateDetail } from '@/modules/catalog/candidates/candidate-detail';
import OverviewTab from './OverviewTab';

function detail(overrides: Partial<CandidateDetail> = {}): CandidateDetail {
  return {
    candidate: {
      id: 'candidate-a',
      supplier: 'CJ_DROPSHIPPING',
      externalProductId: 'CJYD3044514',
      intendedSellerId: 'legacy',
      supplierConnectionId: 'connection-a',
      intendedMarketCodes: ['AU'],
      shortlistState: 'SHORTLISTED',
      providerCategoryId: 'D2432903',
      providerCategoryName: 'Lady Dresses',
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
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      createdBy: 'system',
      updatedAt: new Date('2026-08-12T00:00:00.000Z'),
    } as CandidateDetail['candidate'],
    connection: { id: 'connection-a', status: 'ACTIVE' },
    evaluation: null,
    feedSnapshot: null,
    evidenceSummary: null,
    snapshot: null,
    attestations: [],
    discoverySignals: [],
    productOverrides: [],
    variantOverrides: [],
    auditEvents: [],
    productReferences: [],
    ...overrides,
  };
}

function evaluation(
  overrides: Partial<NonNullable<CandidateDetail['evaluation']>> = {},
) {
  return {
    id: 'evaluation-a',
    candidateId: 'candidate-a',
    status: 'BLOCKED',
    admissionReason: 'NEW_PRODUCT',
    reasonCodes: ['POLICY_BLOCKED'],
    evidenceSummary: null,
    sourceSnapshotChecksum: null,
    policyVersion: 'v1',
    score: 0,
    lastKnownPriceUsdCents: 404,
    lastSeenFingerprint: 'fp-1',
    feedSnapshot: {},
    leasedBy: null,
    leasedUntil: null,
    attemptCount: 1,
    lastErrorCode: null,
    nextRetryAt: null,
    nextRefreshAt: null,
    evaluatedAt: new Date('2026-08-12T04:17:00.000Z'),
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-12T04:17:00.000Z'),
    ...overrides,
  } as NonNullable<CandidateDetail['evaluation']>;
}

describe('OverviewTab', () => {
  /**
   * `score` is reserved and always null in production. Rendering it under a
   * label called "Score" - even as a dash - invites reading it as a real
   * verdict, so the value must never appear and the honest sentence must.
   */
  it('never renders a score value, even when the column holds a number', () => {
    render(<OverviewTab detail={detail({ evaluation: evaluation() })} />);

    expect(screen.queryByText(/^Score$/)).not.toBeInTheDocument();
    expect(
      screen.getByText(/No quality score or publish decision/),
    ).toBeInTheDocument();
  });

  it('marks a permanent reason code as permanent', () => {
    render(<OverviewTab detail={detail({ evaluation: evaluation() })} />);

    expect(screen.getByText('POLICY_BLOCKED')).toBeInTheDocument();
    expect(screen.getByText('Permanent')).toBeInTheDocument();
    expect(screen.queryByText('Retryable')).not.toBeInTheDocument();
  });

  it('marks a recoverable reason code as retryable', () => {
    render(
      <OverviewTab
        detail={detail({
          evaluation: evaluation({
            status: 'TEMPORARILY_INELIGIBLE',
            reasonCodes: ['INVALID_PRICE'],
          }),
        })}
      />,
    );

    expect(screen.getByText('Retryable')).toBeInTheDocument();
    expect(screen.queryByText('Permanent')).not.toBeInTheDocument();
  });

  /** A candidate discovered but never queued has no decision to show - and must say so. */
  it('says the candidate was never queued when there is no evaluation', () => {
    render(<OverviewTab detail={detail()} />);

    expect(
      screen.getByText(/never been queued for evaluation/),
    ).toBeInTheDocument();
  });

  it('renders "Not captured" rather than a dash for absent fields', () => {
    render(<OverviewTab detail={detail()} />);

    expect(screen.getAllByText('Not captured').length).toBeGreaterThan(0);
  });
});
