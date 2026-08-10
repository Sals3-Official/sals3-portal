import { and, asc, eq, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import type { DbExecutor } from '@/lib/db/client';
import {
  productSubscriptions,
  type ProductSubscriptionRow,
} from '@/lib/db/schema';

/**
 * CJ product webhook-subscription state (ADR-013 §4): desired versus
 * observed, reconciled in bounded batches of at most 100 ids per provider
 * request. Only selected/imported/live/accepted-order products are ever
 * desired - callers own that scoping; nothing here subscribes the raw
 * candidate pool, and `subscribeAll` does not exist in this codebase.
 */

export async function upsertDesiredSubscription(
  executor: DbExecutor,
  input: {
    supplierConnectionId: string;
    externalProductId: string;
    desiredState: 'SUBSCRIBED' | 'UNSUBSCRIBED';
  },
): Promise<void> {
  await executor
    .insert(productSubscriptions)
    .values({
      supplierConnectionId: input.supplierConnectionId,
      externalProductId: input.externalProductId,
      desiredState: input.desiredState,
    })
    .onConflictDoUpdate({
      target: [
        productSubscriptions.supplierConnectionId,
        productSubscriptions.externalProductId,
      ],
      set: {
        desiredState: input.desiredState,
        nextRetryAt: null,
        updatedAt: new Date(),
      },
    });
}

/**
 * Rows whose observed state diverges from desire and whose retry backoff
 * (if any) has elapsed - the bounded work list for one reconcile batch.
 */
export async function listDivergentSubscriptions(
  executor: DbExecutor,
  input: { supplierConnectionId: string; limit: number },
): Promise<ProductSubscriptionRow[]> {
  return executor
    .select()
    .from(productSubscriptions)
    .where(
      and(
        eq(
          productSubscriptions.supplierConnectionId,
          input.supplierConnectionId,
        ),
        ne(
          productSubscriptions.observedState,
          // Postgres cannot compare the two enum types directly; text-compare
          // the underlying labels, which are identical by construction.
          sql`${productSubscriptions.desiredState}::text::subscription_observed_state`,
        ),
        or(
          isNull(productSubscriptions.nextRetryAt),
          lte(productSubscriptions.nextRetryAt, new Date()),
        ),
      ),
    )
    .orderBy(asc(productSubscriptions.updatedAt))
    .limit(input.limit);
}

export async function markSubscriptionsObserved(
  executor: DbExecutor,
  input: {
    ids: string[];
    observedState: 'SUBSCRIBED' | 'UNSUBSCRIBED';
  },
): Promise<void> {
  if (input.ids.length === 0) return;

  await executor
    .update(productSubscriptions)
    .set({
      observedState: input.observedState,
      lastVerifiedAt: new Date(),
      lastErrorCode: null,
      nextRetryAt: null,
      updatedAt: new Date(),
    })
    .where(inArray(productSubscriptions.id, input.ids));
}

export async function markSubscriptionAttemptFailed(
  executor: DbExecutor,
  input: { ids: string[]; errorCode: string; nextRetryAt: Date },
): Promise<void> {
  if (input.ids.length === 0) return;

  await executor
    .update(productSubscriptions)
    .set({
      attempts: sql`${productSubscriptions.attempts} + 1`,
      lastErrorCode: input.errorCode,
      nextRetryAt: input.nextRetryAt,
      updatedAt: new Date(),
    })
    .where(inArray(productSubscriptions.id, input.ids));
}
