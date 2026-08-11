import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@/lib/db/client', () => ({
  default: () => ({
    transaction: (run: (tx: unknown) => Promise<unknown>) => run({ tx: true }),
  }),
  isDatabaseConfigured: () => true,
}));

vi.mock('@/lib/auth/seller-guard', () => ({
  requireDropshipperAccount: vi.fn(),
}));

vi.mock('@/modules/catalog/candidates/repository', () => ({
  appendAuditEvent: vi.fn(),
  candidateBelongsToSeller: vi.fn(),
  requeueForManualRecheck: vi.fn(),
}));

vi.mock('@/modules/catalog/candidates/stock-review-repository', () => ({
  recordStockAttestation: vi.fn(),
}));

// eslint-disable-next-line import/first
import { PermissionError } from '@/lib/auth/permissions';
// eslint-disable-next-line import/first
import { requireDropshipperAccount } from '@/lib/auth/seller-guard';
// eslint-disable-next-line import/first
import { resetRateLimiter } from '@/lib/rate-limit';
// eslint-disable-next-line import/first
import {
  appendAuditEvent,
  candidateBelongsToSeller,
} from '@/modules/catalog/candidates/repository';
// eslint-disable-next-line import/first
import { recordStockAttestation } from '@/modules/catalog/candidates/stock-review-repository';
// eslint-disable-next-line import/first
import { recordManualStockCheck } from './actions';

/**
 * Manual stock attestation (ADR-013 §1a). The security posture under test:
 * every control is server-side, they run in a fixed order, and a cross-tenant
 * id, a missing row, and a stale/duplicate submit are all indistinguishable
 * in the response.
 */

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

/** A real RFC-4122 v4 UUID: the action's schema rejects anything else. */
const CANDIDATE_ID = '7d9a1e4a-3f5c-4b8d-8e1f-2c3d4e5f6a7b';

function session(role: string) {
  return {
    session: {
      userId: 'user-1',
      displayName: 'Staffer',
      role,
      sellerId: 'seller-1',
      sellerBusinessModel: 'DROPSHIPPER',
    },
    sellerAccount: { id: 'seller-account-1' },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimiter();
  asMock(requireDropshipperAccount).mockResolvedValue(
    session('seller_manager'),
  );
  asMock(candidateBelongsToSeller).mockResolvedValue(true);
  asMock(recordStockAttestation).mockResolvedValue({ ok: true, newVersion: 1 });
});

describe('recordManualStockCheck', () => {
  it('persists actor, time, and state, and audits the check as manual - not API-verified', async () => {
    const result = await recordManualStockCheck({
      candidateId: CANDIDATE_ID,
      state: 'MANUALLY_IN_STOCK',
      expectedVersion: 0,
      observedQuantity: 12,
      observedOrigin: 'CN warehouse',
      note: 'Counted on MyCJ',
    });

    expect(result).toEqual({ ok: true, newVersion: 1 });

    const [, written] = asMock(recordStockAttestation).mock.calls[0];

    expect(written.actorId).toBe('user-1');
    expect(written.sellerAccountId).toBe('seller-account-1');
    expect(written.state).toBe('MANUALLY_IN_STOCK');
    expect(written.observedAt).toBeInstanceOf(Date);
    expect(written.expectedVersion).toBe(0);

    const [, audit] = asMock(appendAuditEvent).mock.calls[0];

    expect(audit.action).toBe('CANDIDATE_MANUAL_STOCK_ATTESTED');
    expect(audit.payload.evidenceKind).toBe(
      'MANUAL_SUPPLIER_WEBSITE_INSPECTION',
    );
    expect(audit.payload.supplierApiCalled).toBe(false);
  });

  it('routes a no-inventory finding to a visible attention state, recoverably', async () => {
    await recordManualStockCheck({
      candidateId: CANDIDATE_ID,
      state: 'MANUALLY_NO_INVENTORY',
      expectedVersion: 0,
    });

    const [, written] = asMock(recordStockAttestation).mock.calls[0];

    // `MANUALLY_NO_INVENTORY` is what the Needs attention view filters on,
    // and nothing here blocks or deletes the candidate.
    expect(written.state).toBe('MANUALLY_NO_INVENTORY');
  });

  it('rejects a role without the attestation permission', async () => {
    asMock(requireDropshipperAccount).mockResolvedValue(session('viewer'));

    await expect(
      recordManualStockCheck({
        candidateId: CANDIDATE_ID,
        state: 'MANUALLY_IN_STOCK',
        expectedVersion: 0,
      }),
    ).resolves.toEqual({ ok: false, reason: 'denied' });

    expect(recordStockAttestation).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated or non-dropshipper actor', async () => {
    asMock(requireDropshipperAccount).mockRejectedValue(new PermissionError());

    await expect(
      recordManualStockCheck({
        candidateId: CANDIDATE_ID,
        state: 'MANUALLY_IN_STOCK',
        expectedVersion: 0,
      }),
    ).resolves.toEqual({ ok: false, reason: 'denied' });
  });

  it('rejects another seller’s candidate with the same answer as a missing one', async () => {
    asMock(candidateBelongsToSeller).mockResolvedValue(false);

    await expect(
      recordManualStockCheck({
        candidateId: CANDIDATE_ID,
        state: 'MANUALLY_IN_STOCK',
        expectedVersion: 0,
      }),
    ).resolves.toEqual({ ok: false, reason: 'not_found_or_stale' });

    expect(recordStockAttestation).not.toHaveBeenCalled();
  });

  it('rejects a malformed state, id, version, and over-long note', async () => {
    await expect(
      recordManualStockCheck({
        candidateId: CANDIDATE_ID,
        state: 'STOCK_NOT_CHECKED' as never,
        expectedVersion: 0,
      }),
    ).resolves.toEqual({ ok: false, reason: 'invalid_input' });

    await expect(
      recordManualStockCheck({
        candidateId: 'not-a-uuid',
        state: 'MANUALLY_IN_STOCK',
        expectedVersion: 0,
      }),
    ).resolves.toEqual({ ok: false, reason: 'invalid_input' });

    await expect(
      recordManualStockCheck({
        candidateId: CANDIDATE_ID,
        state: 'MANUALLY_IN_STOCK',
        expectedVersion: -1,
      }),
    ).resolves.toEqual({ ok: false, reason: 'invalid_input' });

    await expect(
      recordManualStockCheck({
        candidateId: CANDIDATE_ID,
        state: 'MANUALLY_IN_STOCK',
        expectedVersion: 0,
        note: 'x'.repeat(501),
      }),
    ).resolves.toEqual({ ok: false, reason: 'invalid_input' });
  });

  it('redacts credential-shaped text before persisting a note', async () => {
    await recordManualStockCheck({
      candidateId: CANDIDATE_ID,
      state: 'MANUALLY_COULD_NOT_VERIFY',
      expectedVersion: 0,
      note: 'Logged in with password hunter2 and api-key: abc123',
    });

    const [, written] = asMock(recordStockAttestation).mock.calls[0];

    expect(written.note).not.toContain('hunter2');
    expect(written.note).not.toContain('abc123');
    expect(written.note).toContain('[redacted]');
  });

  it('rejects a stale or duplicate submit rather than overwriting a newer observation', async () => {
    asMock(recordStockAttestation).mockResolvedValue({
      ok: false,
      reason: 'not_found_or_stale',
    });

    await expect(
      recordManualStockCheck({
        candidateId: CANDIDATE_ID,
        state: 'MANUALLY_IN_STOCK',
        expectedVersion: 0,
      }),
    ).resolves.toEqual({ ok: false, reason: 'not_found_or_stale' });

    expect(appendAuditEvent).not.toHaveBeenCalled();
  });

  it('rate limits a burst from one actor', async () => {
    const attempts = await Promise.all(
      Array.from({ length: 40 }, () =>
        recordManualStockCheck({
          candidateId: CANDIDATE_ID,
          state: 'MANUALLY_IN_STOCK',
          expectedVersion: 0,
        }),
      ),
    );

    expect(
      attempts.some((result) => !result.ok && result.reason === 'rate_limited'),
    ).toBe(true);
  });
});
