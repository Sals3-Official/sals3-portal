import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  default: () => ({
    transaction: (run: (tx: unknown) => Promise<unknown>) => run({ tx: true }),
  }),
  isDatabaseConfigured: () => true,
}));

vi.mock('@/lib/country-policy/buyer-destination-country', () => ({
  default: () => ({
    countryCodes: ['AU', 'PH'],
    policyVersion: 'buyer-destination-country-v2-au-ph',
    source: 'test',
    effective: 'ENABLED',
  }),
}));

vi.mock('@/modules/suppliers/repository', () => ({
  listWorkableConnections: vi.fn(),
}));

vi.mock('../candidates/repository', () => ({
  countPolicyVersionMismatches: vi.fn(),
  requeuePolicyVersionMismatches: vi.fn(),
}));

vi.mock('./outbox-repository', () => ({ insertOutboxIntents: vi.fn() }));
vi.mock('./outbox-dispatch', () => ({ default: vi.fn() }));

// eslint-disable-next-line import/first
import { listWorkableConnections } from '@/modules/suppliers/repository';
// eslint-disable-next-line import/first
import {
  countPolicyVersionMismatches,
  requeuePolicyVersionMismatches,
} from '../candidates/repository';
// eslint-disable-next-line import/first
import dispatchOutbox from './outbox-dispatch';
// eslint-disable-next-line import/first
import recheckPolicyVersionMismatches from './recheck-control';

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const CONNECTION_ID = '6aa82ace-e1bb-42cb-88b0-af5e0917d0f5';

beforeEach(() => {
  vi.clearAllMocks();
  asMock(listWorkableConnections).mockResolvedValue([
    { id: CONNECTION_ID, status: 'CONNECTED' },
  ]);
  asMock(requeuePolicyVersionMismatches).mockResolvedValue([]);
  asMock(countPolicyVersionMismatches).mockResolvedValue(0);
  asMock(dispatchOutbox).mockResolvedValue({ dispatched: 0, failed: 0 });
});

describe('recheckPolicyVersionMismatches - the unbounded escape hatch', () => {
  it('passes NO freeze line, so the owner can still re-open the frozen historical backlog', async () => {
    // The automatic sweep is bounded by the backlog gate's activation instant
    // so historical rows stop blocking new discovery. This owner-triggered path
    // must stay unbounded, or the freeze becomes irreversible without a deploy
    // - it is how the backlog gets re-opened once `intended_market_codes` is
    // backfilled.
    await recheckPolicyVersionMismatches({ limit: 500 });

    expect(requeuePolicyVersionMismatches).toHaveBeenCalledWith(
      expect.anything(),
      CONNECTION_ID,
      expect.not.objectContaining({ createdAfter: expect.anything() }),
    );
  });

  it('still reports the remaining count so a bounded call can be repeated deliberately', async () => {
    asMock(requeuePolicyVersionMismatches).mockResolvedValue(['a', 'b']);
    asMock(countPolicyVersionMismatches).mockResolvedValue(86_000);

    await expect(
      recheckPolicyVersionMismatches({ limit: 2 }),
    ).resolves.toMatchObject({
      requeued: 2,
      results: [{ supplierConnectionId: CONNECTION_ID, remaining: 86_000 }],
    });
  });
});
