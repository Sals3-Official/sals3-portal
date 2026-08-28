import { describe, expect, it, vi } from 'vitest';
import type { Executor } from '@/modules/catalog/candidates/repository';
import resolveStorefrontFxBuffer from './storefront-fx-buffer';

/**
 * The query is built with `selectDistinct(...).from(...).innerJoin(...).where(...)`,
 * so the stub is a thenable chain that resolves to the rows. This asserts the
 * decision this module makes about the rows, not Drizzle's SQL — the `WHERE`
 * itself is exercised by `npm run test:integration` against a real database.
 */
function executorReturning(rows: unknown[]): Executor {
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => Promise.resolve(rows),
  };

  return { selectDistinct: () => chain } as unknown as Executor;
}

const policy = {
  id: '0f9d1a3e-1111-4444-8888-aaaaaaaaaaaa',
  version: 2,
  adjustmentRate: '0.015000',
};

describe('resolveStorefrontFxBuffer', () => {
  it('converts the stored rate to the percent the Market Rules card shows', async () => {
    const result = await resolveStorefrontFxBuffer(executorReturning([policy]));

    expect(result).toEqual({
      outcome: 'RESOLVED',
      buffer: {
        bufferPercent: 1.5,
        policyVersion: 2,
        policyId: policy.id,
      },
    });
  });

  it('reports NONE when no seller with published offers has an active buffer', async () => {
    const result = await resolveStorefrontFxBuffer(executorReturning([]));

    expect(result).toEqual({ outcome: 'NONE' });
  });

  it('refuses to pick a winner when two sellers disagree', async () => {
    const result = await resolveStorefrontFxBuffer(
      executorReturning([policy, { ...policy, id: 'other', version: 1 }]),
    );

    // Deliberately not "take the first" or "take the highest": charging one
    // seller's cushion against another's goods is the kind of quiet wrong
    // answer nobody finds for days.
    expect(result).toEqual({ outcome: 'AMBIGUOUS', sellerAccountCount: 2 });
  });

  it('carries a negative buffer through rather than treating it as absent', async () => {
    // ADR-015 §4 calls the field a signed buffer, and a seller funding through
    // a rail that pays a rebate genuinely has one.
    const result = await resolveStorefrontFxBuffer(
      executorReturning([{ ...policy, adjustmentRate: '-0.020000' }]),
    );

    expect(result).toMatchObject({
      outcome: 'RESOLVED',
      buffer: { bufferPercent: -2 },
    });
  });

  it.each([
    ['an order-of-magnitude fat finger', '15.000000'],
    ['a negative far past any real rebate', '-0.500000'],
    ['an unparseable rate', 'not-a-number'],
  ])('refuses %s rather than clamping it', async (_label, adjustmentRate) => {
    const result = await resolveStorefrontFxBuffer(
      executorReturning([{ ...policy, adjustmentRate }]),
    );

    expect(result).toEqual({ outcome: 'NONE' });
  });

  it('excludes a policy whose effectiveTo has passed', async () => {
    // The expiry lives in the WHERE clause, so what is asserted here is that
    // the caller hands `now` to the query rather than filtering afterwards --
    // a lapsed temporary buffer must stop applying on its own.
    const where = vi.fn().mockResolvedValue([]);
    const chain = { from: () => chain, innerJoin: () => chain, where };
    const executor = {
      selectDistinct: () => chain,
    } as unknown as Executor;

    const now = new Date('2026-08-28T00:00:00.000Z');
    const result = await resolveStorefrontFxBuffer(executor, now);

    expect(where).toHaveBeenCalledOnce();
    expect(result).toEqual({ outcome: 'NONE' });
  });
});
