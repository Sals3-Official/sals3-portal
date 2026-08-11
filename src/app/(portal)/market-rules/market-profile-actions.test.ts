import { beforeEach, describe, expect, it, vi } from 'vitest';

const TX = { __tx: true } as const;

const { getDbMock, transactionMock } = vi.hoisted(() => {
  const transaction = vi.fn(async (callback: (tx: unknown) => unknown) =>
    callback({ __tx: true }),
  );

  return {
    transactionMock: transaction,
    getDbMock: vi.fn(() => ({ __pool: true, transaction })),
  };
});

vi.mock('@/lib/db/client', () => ({ default: getDbMock }));

const { requirePermissionMock } = vi.hoisted(() => ({
  requirePermissionMock: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({
  requirePermission: requirePermissionMock,
}));

const { checkRateLimitMock } = vi.hoisted(() => ({
  checkRateLimitMock: vi.fn(() => ({ allowed: true })),
}));

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: checkRateLimitMock }));

const { appendAuditEventMock } = vi.hoisted(() => ({
  appendAuditEventMock: vi.fn(),
}));

vi.mock('@/modules/catalog/candidates/repository', () => ({
  appendAuditEvent: appendAuditEventMock,
}));

const repositoryMocks = vi.hoisted(() => ({
  createDraftProfile: vi.fn(),
  transitionProfileForSeller: vi.fn(),
}));

vi.mock('@/modules/market-config/repository', () => repositoryMocks);

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

/* eslint-disable import/first */
import { PermissionError } from '@/lib/auth/permissions';
import {
  activateMarketProfileAction,
  beginMarketProfileSetupAction,
  suspendMarketProfileAction,
} from './market-profile-actions';

const SELLER_A_ID = '11111111-1111-4111-a111-111111111111';
const SELLER_B_ID = '22222222-2222-4222-a222-222222222222';
const PROFILE_A_ID = '33333333-3333-4333-a333-333333333333';
const PROFILE_B_ID = '44444444-4444-4444-a444-444444444444';

/** Seller A is always the authenticated caller. */
const SESSION = { sellerId: SELLER_A_ID, userId: 'user-1' };

const VALID_REASON = 'Opening this destination for the bounded pilot.';

/**
 * Reproduces what the scoped compare-and-set `UPDATE` does — match on owner,
 * status, and version, or change nothing. A mock that ignored those
 * arguments would let every isolation and replay test pass vacuously.
 */
type StoredProfile = {
  id: string;
  sellerAccountId: string;
  destinationCountryCode: string;
  capabilityVersion: string;
  status: 'DRAFT' | 'ACTIVE' | 'SUSPENDED';
  version: number;
};

function createProfileStore(rows: StoredProfile[]) {
  const store = new Map(rows.map((row) => [row.id, { ...row }]));

  return {
    transition(input: {
      profileId: string;
      sellerAccountId: string;
      expectedStatus: string;
      expectedVersion: number;
      nextStatus: StoredProfile['status'];
      reason: string;
    }) {
      const row = store.get(input.profileId);
      if (row === undefined) return null;
      if (row.sellerAccountId !== input.sellerAccountId) return null;
      if (row.status !== input.expectedStatus) return null;
      if (row.version !== input.expectedVersion) return null;

      row.status = input.nextStatus;
      row.version += 1;
      return { ...row, reason: input.reason };
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  transactionMock.mockImplementation(
    async (callback: (tx: unknown) => unknown) => callback(TX),
  );
  requirePermissionMock.mockResolvedValue(SESSION);
  checkRateLimitMock.mockReturnValue({ allowed: true });
});

describe('beginMarketProfileSetupAction — authorization and allow list', () => {
  it('requires market_profile:manage, not merely market_rules:read', async () => {
    requirePermissionMock.mockRejectedValue(new PermissionError());

    const result = await beginMarketProfileSetupAction({
      destinationCountryCode: 'AU',
      reason: VALID_REASON,
    });

    expect(result).toEqual({ ok: false, reason: 'denied' });
    expect(requirePermissionMock).toHaveBeenCalledWith('market_profile:manage');
    expect(repositoryMocks.createDraftProfile).not.toHaveBeenCalled();
  });

  it('takes the seller from the session, never from the caller', async () => {
    repositoryMocks.createDraftProfile.mockResolvedValue({
      id: PROFILE_A_ID,
      sellerAccountId: SELLER_A_ID,
      destinationCountryCode: 'AU',
      capabilityVersion: 'v',
      status: 'DRAFT',
      version: 1,
      reason: VALID_REASON,
    });

    // A forged seller id in the payload has nowhere to land: the action
    // schema has no such field and the repository is handed the session's.
    await beginMarketProfileSetupAction({
      destinationCountryCode: 'AU',
      reason: VALID_REASON,
      sellerAccountId: SELLER_B_ID,
    });

    expect(repositoryMocks.createDraftProfile).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ sellerAccountId: SELLER_A_ID }),
    );
  });

  it.each(['SG', 'ID', 'US', 'au', 'AUSTRALIA', ''])(
    'refuses unapproved destination %s server-side',
    async (destinationCountryCode) => {
      const result = await beginMarketProfileSetupAction({
        destinationCountryCode,
        reason: VALID_REASON,
      });

      expect(result.ok).toBe(false);
      expect(repositoryMocks.createDraftProfile).not.toHaveBeenCalled();
      expect(appendAuditEventMock).not.toHaveBeenCalled();
    },
  );

  it('requires a real business reason', async () => {
    const result = await beginMarketProfileSetupAction({
      destinationCountryCode: 'AU',
      reason: 'why',
    });

    expect(result).toEqual({ ok: false, reason: 'invalid_input' });
    expect(requirePermissionMock).not.toHaveBeenCalled();
  });

  it('creates a DRAFT — the global AU+PH policy never auto-activates anything', async () => {
    repositoryMocks.createDraftProfile.mockResolvedValue({
      id: PROFILE_A_ID,
      sellerAccountId: SELLER_A_ID,
      destinationCountryCode: 'AU',
      capabilityVersion: 'seller-market-capability-v1-au-ph-bounded-pilot',
      status: 'DRAFT',
      version: 1,
      reason: VALID_REASON,
    });

    const result = await beginMarketProfileSetupAction({
      destinationCountryCode: 'AU',
      reason: VALID_REASON,
    });

    expect(result).toEqual({ ok: true });
    expect(appendAuditEventMock).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        action: 'seller_market_profile.draft_created',
        entityType: 'SellerMarketProfile',
        entityId: PROFILE_A_ID,
        payload: expect.objectContaining({
          sellerAccountId: SELLER_A_ID,
          status: 'DRAFT',
        }),
      }),
    );
  });

  it('reports a duplicate setup as a conflict rather than a crash', async () => {
    repositoryMocks.createDraftProfile.mockRejectedValue(
      new Error(
        'duplicate key value violates unique constraint "seller_market_profiles_live_key"',
      ),
    );

    const result = await beginMarketProfileSetupAction({
      destinationCountryCode: 'AU',
      reason: VALID_REASON,
    });

    expect(result).toEqual({ ok: false, reason: 'conflict' });
  });
});

describe('market profile lifecycle — cross-tenant and replay safety', () => {
  beforeEach(() => {
    const { transition } = createProfileStore([
      {
        id: PROFILE_A_ID,
        sellerAccountId: SELLER_A_ID,
        destinationCountryCode: 'AU',
        capabilityVersion: 'v1',
        status: 'DRAFT',
        version: 1,
      },
      {
        id: PROFILE_B_ID,
        sellerAccountId: SELLER_B_ID,
        destinationCountryCode: 'PH',
        capabilityVersion: 'v1',
        status: 'DRAFT',
        version: 1,
      },
    ]);

    repositoryMocks.transitionProfileForSeller.mockImplementation(
      async (_tx: unknown, input: Parameters<typeof transition>[0]) =>
        transition(input),
    );
  });

  it("cannot activate Seller B's profile by id", async () => {
    const result = await activateMarketProfileAction({
      profileId: PROFILE_B_ID,
      expectedVersion: 1,
      reason: VALID_REASON,
    });

    expect(result).toEqual({ ok: false, reason: 'not_found' });
    expect(appendAuditEventMock).not.toHaveBeenCalled();
  });

  it("cannot suspend Seller B's profile by id", async () => {
    const result = await suspendMarketProfileAction({
      profileId: PROFILE_B_ID,
      expectedVersion: 1,
      reason: VALID_REASON,
    });

    expect(result).toEqual({ ok: false, reason: 'not_found' });
    expect(appendAuditEventMock).not.toHaveBeenCalled();
  });

  it("does not reveal whether another tenant's profile exists", async () => {
    const foreign = await activateMarketProfileAction({
      profileId: PROFILE_B_ID,
      expectedVersion: 1,
      reason: VALID_REASON,
    });
    const absent = await activateMarketProfileAction({
      profileId: '55555555-5555-4555-a555-555555555555',
      expectedVersion: 1,
      reason: VALID_REASON,
    });

    expect(foreign).toEqual(absent);
  });

  it('passes the authenticated seller id to the repository', async () => {
    await activateMarketProfileAction({
      profileId: PROFILE_B_ID,
      expectedVersion: 1,
      reason: VALID_REASON,
    });

    expect(repositoryMocks.transitionProfileForSeller).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ sellerAccountId: SELLER_A_ID }),
    );
  });

  it("activates the caller's own draft and audits the transition", async () => {
    const result = await activateMarketProfileAction({
      profileId: PROFILE_A_ID,
      expectedVersion: 1,
      reason: VALID_REASON,
    });

    expect(result).toEqual({ ok: true });
    expect(appendAuditEventMock).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        action: 'seller_market_profile.activated',
        payload: expect.objectContaining({
          previousStatus: 'DRAFT',
          status: 'ACTIVE',
          previousVersion: 1,
          version: 2,
        }),
      }),
    );
  });

  it('rejects a stale version — a double submit cannot re-run the transition', async () => {
    const first = await activateMarketProfileAction({
      profileId: PROFILE_A_ID,
      expectedVersion: 1,
      reason: VALID_REASON,
    });
    appendAuditEventMock.mockClear();

    const replay = await activateMarketProfileAction({
      profileId: PROFILE_A_ID,
      expectedVersion: 1,
      reason: VALID_REASON,
    });

    expect(first).toEqual({ ok: true });
    expect(replay).toEqual({ ok: false, reason: 'not_found' });
    expect(appendAuditEventMock).not.toHaveBeenCalled();
  });

  it('rejects a transition from the wrong state', async () => {
    // The profile is DRAFT; suspend expects ACTIVE.
    const result = await suspendMarketProfileAction({
      profileId: PROFILE_A_ID,
      expectedVersion: 1,
      reason: VALID_REASON,
    });

    expect(result).toEqual({ ok: false, reason: 'not_found' });
    expect(appendAuditEventMock).not.toHaveBeenCalled();
  });

  it('supports the real activate-then-suspend path with correct versions', async () => {
    await activateMarketProfileAction({
      profileId: PROFILE_A_ID,
      expectedVersion: 1,
      reason: VALID_REASON,
    });

    const suspended = await suspendMarketProfileAction({
      profileId: PROFILE_A_ID,
      expectedVersion: 2,
      reason: 'Pausing this destination while freight is unresolved.',
    });

    expect(suspended).toEqual({ ok: true });
    expect(appendAuditEventMock).toHaveBeenLastCalledWith(
      TX,
      expect.objectContaining({
        action: 'seller_market_profile.suspended',
        payload: expect.objectContaining({ status: 'SUSPENDED', version: 3 }),
      }),
    );
  });

  it('rejects a forged status supplied by the caller', async () => {
    // Status is derived from which action was called, never from input.
    await activateMarketProfileAction({
      profileId: PROFILE_A_ID,
      expectedVersion: 1,
      reason: VALID_REASON,
      nextStatus: 'ACTIVE',
      status: 'SUSPENDED',
    });

    expect(repositoryMocks.transitionProfileForSeller).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        expectedStatus: 'DRAFT',
        nextStatus: 'ACTIVE',
      }),
    );
  });
});
