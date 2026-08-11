import { describe, expect, it } from 'vitest';
import type { Executor } from '@/modules/catalog/candidates/repository';
import { createDraftProfile, transitionProfileForSeller } from './repository';

/**
 * Covers what these helpers decide in pure logic: what a draft writes, what a
 * transition writes, and what a compare-and-set miss returns.
 *
 * The `WHERE` clause that actually enforces tenancy is Postgres's job;
 * asserting on a Drizzle SQL object's internals would test the query builder
 * rather than this module. The behaviour it produces is covered at the action
 * boundary in `market-profile-actions.test.ts`, and confirming it against a
 * real database needs migration 0012 applied — see this task's report.
 */

type UpdateCall = { set: Record<string, unknown> };
type InsertCall = { values: Record<string, unknown> };

function createFakeExecutor(returningRows: unknown[] = []) {
  const updates: UpdateCall[] = [];
  const inserts: InsertCall[] = [];

  const executor = {
    update() {
      return {
        set(values: Record<string, unknown>) {
          updates.push({ set: values });
          return {
            where: () => ({ returning: () => Promise.resolve(returningRows) }),
          };
        },
      };
    },
    insert() {
      return {
        values(values: Record<string, unknown>) {
          inserts.push({ values });
          return {
            returning: () =>
              Promise.resolve([{ id: 'inserted-profile', ...values }]),
          };
        },
      };
    },
  };

  return {
    updates,
    inserts,
    // Hand-rolled stand-in for Drizzle's executor: implementing the full
    // query-builder type structurally would be far more code than the two
    // methods under test actually call.
    executor: executor as unknown as Executor,
  };
}

const DRAFT_INPUT = {
  sellerAccountId: 'seller-a',
  destinationCountryCode: 'AU',
  capabilityVersion: 'seller-market-capability-v1-au-ph-bounded-pilot',
  source: 'owner-instruction-2026-08-11-au-ph-bounded-pilot',
  reason: 'Opening this destination for the bounded pilot.',
  actorId: 'user-1',
};

describe('createDraftProfile', () => {
  it('starts at DRAFT version 1, never active', async () => {
    const { executor, inserts } = createFakeExecutor();

    await createDraftProfile(executor, DRAFT_INPUT);

    expect(inserts[0].values).toMatchObject({
      sellerAccountId: 'seller-a',
      destinationCountryCode: 'AU',
      status: 'DRAFT',
      version: 1,
    });
  });

  it('records currency, locale, and time zone as absent rather than guessed', async () => {
    const { executor, inserts } = createFakeExecutor();

    await createDraftProfile(executor, DRAFT_INPUT);

    expect(inserts[0].values.sellingCurrencyCode).toBeNull();
    expect(inserts[0].values.locale).toBeNull();
    expect(inserts[0].values.timeZone).toBeNull();
  });

  it('stores which capability version authorized it', async () => {
    const { executor, inserts } = createFakeExecutor();

    await createDraftProfile(executor, DRAFT_INPUT);

    expect(inserts[0].values.capabilityVersion).toBe(
      DRAFT_INPUT.capabilityVersion,
    );
  });
});

describe('transitionProfileForSeller', () => {
  const BASE = {
    profileId: 'profile-1',
    sellerAccountId: 'seller-a',
    expectedStatus: 'DRAFT' as const,
    expectedVersion: 3,
    nextStatus: 'ACTIVE' as const,
    reason: 'Activating for the bounded pilot.',
    actorId: 'user-1',
  };

  it('returns null when the compare-and-set matched nothing', async () => {
    const { executor } = createFakeExecutor([]);

    await expect(
      transitionProfileForSeller(executor, BASE),
    ).resolves.toBeNull();
  });

  it('returns the row it changed', async () => {
    const { executor } = createFakeExecutor([{ id: 'profile-1' }]);

    await expect(transitionProfileForSeller(executor, BASE)).resolves.toEqual({
      id: 'profile-1',
    });
  });

  it('advances the version from the one the caller read', async () => {
    const { executor, updates } = createFakeExecutor([{ id: 'profile-1' }]);

    await transitionProfileForSeller(executor, BASE);

    expect(updates[0].set).toMatchObject({ status: 'ACTIVE', version: 4 });
  });

  it('stamps activatedAt only when activating', async () => {
    const { executor, updates } = createFakeExecutor([{ id: 'profile-1' }]);

    await transitionProfileForSeller(executor, BASE);

    expect(updates[0].set.activatedAt).toBeInstanceOf(Date);
    expect(updates[0].set.suspendedAt).toBeUndefined();
  });

  it('stamps suspendedAt only when suspending', async () => {
    const { executor, updates } = createFakeExecutor([{ id: 'profile-1' }]);

    await transitionProfileForSeller(executor, {
      ...BASE,
      expectedStatus: 'ACTIVE',
      nextStatus: 'SUSPENDED',
    });

    expect(updates[0].set.suspendedAt).toBeInstanceOf(Date);
    expect(updates[0].set.activatedAt).toBeUndefined();
  });

  it('records the reason and actor for the transition', async () => {
    const { executor, updates } = createFakeExecutor([{ id: 'profile-1' }]);

    await transitionProfileForSeller(executor, BASE);

    expect(updates[0].set).toMatchObject({
      reason: BASE.reason,
      actorId: 'user-1',
    });
  });
});
