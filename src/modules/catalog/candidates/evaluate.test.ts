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

vi.mock('../discovery/pilot-allowance-repository', () => ({
  assessPilotAllowance: vi.fn(),
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

const { getCandidateEvidenceMock, resolveBuyerDestinationCountryPolicyMock } =
  vi.hoisted(() => ({
    getCandidateEvidenceMock: vi.fn(),
    resolveBuyerDestinationCountryPolicyMock: vi.fn(),
  }));

// This suite tests orchestration (evidence fetch, retry, connection pause),
// not the market-policy rule itself (see `rules/screening.test.ts`), so an
// enabled policy is the default here - one dedicated test below overrides it
// back to disabled to prove the real fail-closed integration.
vi.mock('@/lib/country-policy/buyer-destination-country', () => ({
  default: resolveBuyerDestinationCountryPolicyMock,
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
import { assessPilotAllowance } from '../discovery/pilot-allowance-repository';
// eslint-disable-next-line import/first
import evaluateCandidate from './evaluate';
// eslint-disable-next-line import/first
import {
  composeEvaluationPolicyVersion,
  MAX_EVALUATION_ATTEMPTS,
  POLICY_VERSION,
} from './rules/policy';

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const CANDIDATE: SupplierCandidateRow = {
  id: 'candidate-1',
  supplier: 'CJ_DROPSHIPPING',
  externalProductId: 'CJLY1',
  supplierConnectionId: 'connection-1',
  intendedSellerId: 'seller-account-1',
  // Matches the beforeEach's default enabled buyer-destination mock
  // (['TEST']) so the orchestration tests below reach the full evidence-
  // fetch path. The market-scope rule itself (candidate destination vs.
  // enabled allowlist) is unit-tested in `rules/screening.test.ts` and
  // exercised end-to-end below.
  intendedMarketCodes: ['TEST'],
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
    nextRefreshAt: null,
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
      stockByOrigin: [
        {
          countryCode: 'CN',
          totalInventory: 10,
          cjInventory: 10,
          factoryInventory: 0,
          verifiedWarehouse: 'VERIFIED',
        },
      ],
      totalInventory: 10,
      stockEvidence: 'CJ_WAREHOUSE_STOCK',
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
    resolveBuyerDestinationCountryPolicyMock.mockReset().mockReturnValue({
      countryCodes: ['TEST'],
      policyVersion: 'test-buyer-destination-v1',
      source: 'test-fixture',
      effective: 'ENABLED',
    });
    asMock(assessPilotAllowance)
      .mockReset()
      .mockResolvedValue({ exhausted: false, paidCount: 0, limit: 2_000 });
  });

  it('fails closed with NO_VALID_MARKET when no buyer destination-country policy is enabled', async () => {
    resolveBuyerDestinationCountryPolicyMock.mockReturnValue({
      countryCodes: [],
      policyVersion: 'buyer-destination-country-v1-disabled',
      source: 'no-adr-003-market-approved-yet',
      effective: 'DISABLED',
    });

    await evaluateCandidate(row({}));

    expect(getCandidateEvidenceMock).not.toHaveBeenCalled();
    expect(recordScreeningDecision).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        candidateId: 'candidate-1',
        decision: expect.objectContaining({
          status: 'TEMPORARILY_INELIGIBLE',
          reasonCodes: ['NO_VALID_MARKET'],
        }),
      }),
    );
  });

  it("blocks closed when the candidate's own intended destination is not in the enabled policy (historical PH under an AU-only policy)", async () => {
    asMock(findCandidateById).mockResolvedValue({
      ...CANDIDATE,
      intendedMarketCodes: ['PH'],
    });
    resolveBuyerDestinationCountryPolicyMock.mockReturnValue({
      countryCodes: ['AU'],
      policyVersion: 'buyer-destination-country-v1',
      source: 'owner-decision-2026-08-10-au-business-registration',
      effective: 'ENABLED',
    });

    await evaluateCandidate(row({}));

    expect(getCandidateEvidenceMock).not.toHaveBeenCalled();
    expect(recordScreeningDecision).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        decision: expect.objectContaining({
          status: 'TEMPORARILY_INELIGIBLE',
          reasonCodes: ['NO_VALID_MARKET'],
        }),
      }),
    );
  });

  it('blocks closed when the candidate has no intended destination at all, even under an enabled policy', async () => {
    asMock(findCandidateById).mockResolvedValue({
      ...CANDIDATE,
      intendedMarketCodes: [],
    });

    await evaluateCandidate(row({}));

    expect(getCandidateEvidenceMock).not.toHaveBeenCalled();
    expect(recordScreeningDecision).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        decision: expect.objectContaining({
          status: 'TEMPORARILY_INELIGIBLE',
          reasonCodes: ['NO_VALID_MARKET'],
        }),
      }),
    );
  });

  it('resolves the buyer-destination policy exactly once per evaluation and reuses that same snapshot everywhere', async () => {
    getCandidateEvidenceMock.mockResolvedValue(CLEAN_EVIDENCE);

    await evaluateCandidate(row({}));

    // Not "at least once" - exactly once, so the market rule, the stored
    // policy identity, and the audit payload can never disagree because
    // they observed two different resolver calls.
    expect(resolveBuyerDestinationCountryPolicyMock).toHaveBeenCalledTimes(1);
  });

  it('persists a stored policy identity that composes the catalog and buyer-destination versions, and changes deterministically when the buyer version changes', async () => {
    getCandidateEvidenceMock.mockResolvedValue(CLEAN_EVIDENCE);

    await evaluateCandidate(row({}));

    const firstPolicyVersion = asMock(recordEvaluationDecision).mock
      .calls[0]?.[1]?.policyVersion;

    expect(firstPolicyVersion).toBe(
      composeEvaluationPolicyVersion(
        POLICY_VERSION,
        'test-buyer-destination-v1',
      ),
    );

    asMock(recordEvaluationDecision).mockReset().mockResolvedValue(undefined);
    resolveBuyerDestinationCountryPolicyMock.mockReturnValue({
      countryCodes: ['TEST'],
      policyVersion: 'test-buyer-destination-v2',
      source: 'test-fixture',
      effective: 'ENABLED',
    });

    await evaluateCandidate(row({}));

    const secondPolicyVersion = asMock(recordEvaluationDecision).mock
      .calls[0]?.[1]?.policyVersion;

    expect(secondPolicyVersion).toBe(
      composeEvaluationPolicyVersion(
        POLICY_VERSION,
        'test-buyer-destination-v2',
      ),
    );
    expect(secondPolicyVersion).not.toBe(firstPolicyVersion);
  });

  it('records the buyer-destination policy version, source, effective state, enabled codes, and the candidate scope in the audit payload', async () => {
    getCandidateEvidenceMock.mockResolvedValue(CLEAN_EVIDENCE);

    await evaluateCandidate(row({}));

    expect(appendAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'CANDIDATE_EVALUATION_DECIDED',
        payload: expect.objectContaining({
          catalogPolicyVersion: POLICY_VERSION,
          buyerDestinationPolicyVersion: 'test-buyer-destination-v1',
          buyerDestinationPolicySource: 'test-fixture',
          buyerDestinationPolicyEffective: 'ENABLED',
          buyerDestinationEnabledCountryCodes: ['TEST'],
          candidateIntendedDestinationCodes: ['TEST'],
        }),
      }),
    );
  });

  it('records the same market audit fields on a screening-blocked decision', async () => {
    resolveBuyerDestinationCountryPolicyMock.mockReturnValue({
      countryCodes: [],
      policyVersion: 'buyer-destination-country-v1-disabled',
      source: 'no-adr-003-market-approved-yet',
      effective: 'DISABLED',
    });

    await evaluateCandidate(row({}));

    expect(appendAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'CANDIDATE_SCREENING_DECIDED',
        payload: expect.objectContaining({
          catalogPolicyVersion: POLICY_VERSION,
          buyerDestinationPolicyVersion:
            'buyer-destination-country-v1-disabled',
          buyerDestinationPolicyEffective: 'DISABLED',
          buyerDestinationEnabledCountryCodes: [],
          candidateIntendedDestinationCodes: ['TEST'],
        }),
      }),
    );
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

  it('never consults the pilot allowance for a screening-blocked candidate', async () => {
    // The load-bearing guarantee of the pilot cap: a decision that costs no
    // CJ points must never consume a paid slot. The gate sits below every
    // free exit, so this is true by construction - and this test is what
    // keeps it that way if the gate is ever moved.
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

    expect(assessPilotAllowance).not.toHaveBeenCalled();
  });

  it('never consults the pilot allowance when the connection is not workable', async () => {
    asMock(findConnectionById).mockResolvedValue({
      ...CONNECTION,
      status: 'DISCONNECTED',
    });

    await evaluateCandidate(row({}));

    expect(assessPilotAllowance).not.toHaveBeenCalled();
    expect(getCandidateEvidenceMock).not.toHaveBeenCalled();
  });

  it('refuses the evidence fetch once the pilot allowance is exhausted, without burning an attempt', async () => {
    asMock(assessPilotAllowance).mockResolvedValue({
      exhausted: true,
      paidCount: 2_000,
      limit: 2_000,
    });

    await evaluateCandidate(row({ attemptCount: 2 }));

    expect(getCandidateEvidenceMock).not.toHaveBeenCalled();
    expect(recordEvaluationFailure).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        candidateId: 'candidate-1',
        // Unchanged, not incremented: the product did nothing wrong, and an
        // untouched attempt budget also keeps the row out of the Exception
        // Queue, whose filter requires an exhausted one.
        attemptCount: 2,
        lastErrorCode: 'pilot_cap_reached',
        // No backoff clock - recovery is the owner raising the cap.
        nextRetryAt: null,
      }),
    );
    expect(appendAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'CANDIDATE_EVALUATION_REFUSED_PILOT_ALLOWANCE',
        payload: expect.objectContaining({ paidCount: 2_000, limit: 2_000 }),
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

  it('defers a rate-limited fetch WITHOUT burning an attempt - load pressure can never dead-letter a healthy product', async () => {
    getCandidateEvidenceMock.mockRejectedValue(new CjApiError('rate-limited'));

    await evaluateCandidate(row({ attemptCount: 2 }));

    expect(recordEvaluationFailure).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        candidateId: 'candidate-1',
        // Attempt budget untouched (ADR-013 §5: recoverable connection
        // health, not a technical failure of the product).
        attemptCount: 2,
        lastErrorCode: 'rate-limited',
        nextRetryAt: expect.any(Date),
      }),
    );
    expect(appendAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'CANDIDATE_EVALUATION_RATE_LIMIT_DEFERRED',
      }),
    );
    expect(recordEvaluationDecision).not.toHaveBeenCalled();
  });

  it('never dead-letters from rate limiting even at the attempt ceiling - the defer keeps a retry time', async () => {
    getCandidateEvidenceMock.mockRejectedValue(new CjApiError('rate-limited'));

    await evaluateCandidate(row({ attemptCount: MAX_EVALUATION_ATTEMPTS - 1 }));

    expect(recordEvaluationFailure).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        attemptCount: MAX_EVALUATION_ATTEMPTS - 1,
        nextRetryAt: expect.any(Date),
      }),
    );
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
