import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  default: () => ({}),
  isDatabaseConfigured: () => true,
}));

vi.mock('@/lib/secrets/postgres-supplier-secret-store', () => ({
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

vi.mock('./subscription-repository', () => ({
  countObservedSubscribed: vi.fn(),
  listDivergentSubscriptions: vi.fn(),
  markSubscriptionAttemptFailed: vi.fn(),
  markSubscriptionsObserved: vi.fn(),
}));

vi.mock('./budget-repository', () => ({
  findBudgetRow: vi.fn(),
  tryAcquireRequestSlot: vi.fn(),
}));

// eslint-disable-next-line import/first
import type { SupplierProviderAdapter } from '@/modules/suppliers/contracts';
// eslint-disable-next-line import/first
import {
  countObservedSubscribed,
  listDivergentSubscriptions,
  markSubscriptionAttemptFailed,
  markSubscriptionsObserved,
} from './subscription-repository';
// eslint-disable-next-line import/first
import { findBudgetRow, tryAcquireRequestSlot } from './budget-repository';
// eslint-disable-next-line import/first
import reconcileSubscriptions from './subscription-reconcile';

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function subscriptionRow(index: number, desiredState: string) {
  return {
    id: `subscription-${index}`,
    supplierConnectionId: 'connection-1',
    externalProductId: `pid-${index}`,
    desiredState,
    priorityClass: 'READY',
    desiredReason: 'test',
    observedState: 'UNKNOWN',
    attempts: 0,
  };
}

function fakeAdapter(overrides: Partial<SupplierProviderAdapter> = {}) {
  return {
    subscribeProducts: vi.fn().mockResolvedValue(undefined),
    unsubscribeProducts: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as SupplierProviderAdapter;
}

beforeEach(() => {
  vi.clearAllMocks();
  asMock(tryAcquireRequestSlot).mockResolvedValue(true);
  asMock(findBudgetRow).mockResolvedValue({ observedSubscriptionLimit: 1_000 });
  asMock(countObservedSubscribed).mockResolvedValue(0);
});

describe('reconcileSubscriptions', () => {
  it('never sends more than the documented 100 product ids in one provider request', async () => {
    asMock(listDivergentSubscriptions).mockResolvedValue(
      Array.from({ length: 150 }, (_, i) => subscriptionRow(i, 'SUBSCRIBED')),
    );
    const adapter = fakeAdapter();

    const result = await reconcileSubscriptions('connection-1', adapter);

    expect(result.subscribed).toBe(100);
    const sentIds = asMock(adapter.subscribeProducts).mock
      .calls[0]![1] as string[];
    expect(sentIds).toHaveLength(100);
  });

  it('marks observed state only after the provider call succeeded', async () => {
    asMock(listDivergentSubscriptions).mockResolvedValue([
      subscriptionRow(1, 'SUBSCRIBED'),
      subscriptionRow(2, 'UNSUBSCRIBED'),
    ]);
    const adapter = fakeAdapter();

    const result = await reconcileSubscriptions('connection-1', adapter);

    expect(result).toEqual({ subscribed: 1, unsubscribed: 1, failed: 0 });
    expect(markSubscriptionsObserved).toHaveBeenCalledWith(expect.anything(), {
      ids: ['subscription-1'],
      observedState: 'SUBSCRIBED',
    });
    expect(markSubscriptionsObserved).toHaveBeenCalledWith(expect.anything(), {
      ids: ['subscription-2'],
      observedState: 'UNSUBSCRIBED',
    });
  });

  it('records a failed provider call with a retry time - desired state is never faked as observed', async () => {
    asMock(listDivergentSubscriptions).mockResolvedValue([
      subscriptionRow(1, 'SUBSCRIBED'),
    ]);
    const adapter = fakeAdapter({
      subscribeProducts: vi
        .fn()
        .mockRejectedValue(new Error('account limit reached')),
    });

    const result = await reconcileSubscriptions('connection-1', adapter);

    expect(result.failed).toBe(1);
    expect(markSubscriptionsObserved).not.toHaveBeenCalled();
    expect(markSubscriptionAttemptFailed).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        errorCode: 'SUBSCRIBE_FAILED',
        nextRetryAt: expect.any(Date),
      }),
    );
  });

  it('does nothing when desired and observed already agree', async () => {
    asMock(listDivergentSubscriptions).mockResolvedValue([]);
    const adapter = fakeAdapter();

    const result = await reconcileSubscriptions('connection-1', adapter);

    expect(result).toEqual({ subscribed: 0, unsubscribed: 0, failed: 0 });
    expect(adapter.subscribeProducts).not.toHaveBeenCalled();
  });

  it('respects the shared rate limiter - no slot, no provider call, state untouched', async () => {
    asMock(listDivergentSubscriptions).mockResolvedValue([
      subscriptionRow(1, 'SUBSCRIBED'),
    ]);
    asMock(tryAcquireRequestSlot).mockResolvedValue(false);
    const adapter = fakeAdapter();

    await reconcileSubscriptions('connection-1', adapter);

    expect(adapter.subscribeProducts).not.toHaveBeenCalled();
    expect(markSubscriptionsObserved).not.toHaveBeenCalled();
  });
});
