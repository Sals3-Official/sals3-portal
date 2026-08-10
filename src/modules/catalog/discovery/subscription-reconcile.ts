import getDb from '@/lib/db/client';
import PostgresSupplierSecretStore from '@/lib/secrets/postgres-supplier-secret-store';
import CjTokenManager from '@/modules/suppliers/providers/cj/cj-auth';
import CjSupplierAdapter from '@/modules/suppliers/providers/cj/cj-adapter';
import type { SupplierProviderAdapter } from '@/modules/suppliers/contracts';
import {
  listDivergentSubscriptions,
  markSubscriptionAttemptFailed,
  markSubscriptionsObserved,
} from './subscription-repository';
import { tryAcquireRequestSlot } from './budget-repository';

/**
 * Reconciles desired vs observed CJ product subscriptions for one connection
 * in bounded batches of at most 100 ids per provider request (the documented
 * maximum). Only selected/imported/live/accepted-order products ever become
 * desired - the desired set is populated by the (future) selection/import
 * layer, NEVER by discovery; this module only converges observed state onto
 * desire. `subscribeAll` is not used anywhere (unavailable to all users
 * after July 2026).
 */

const PROVIDER_BATCH_MAX = 100;
const RETRY_DELAY_MS = 15 * 60 * 1000;

export default async function reconcileSubscriptions(
  supplierConnectionId: string,
  adapterOverride?: SupplierProviderAdapter,
): Promise<{ subscribed: number; unsubscribed: number; failed: number }> {
  const db = getDb();
  const divergent = await listDivergentSubscriptions(db, {
    supplierConnectionId,
    limit: PROVIDER_BATCH_MAX * 2,
  });

  if (divergent.length === 0) {
    return { subscribed: 0, unsubscribed: 0, failed: 0 };
  }

  const secretStore = new PostgresSupplierSecretStore();
  const adapter =
    adapterOverride ??
    new CjSupplierAdapter(secretStore, new CjTokenManager(secretStore));

  const toSubscribe = divergent
    .filter((row) => row.desiredState === 'SUBSCRIBED')
    .slice(0, PROVIDER_BATCH_MAX);
  const toUnsubscribe = divergent
    .filter((row) => row.desiredState === 'UNSUBSCRIBED')
    .slice(0, PROVIDER_BATCH_MAX);

  let subscribed = 0;
  let unsubscribed = 0;
  let failed = 0;

  if (toSubscribe.length > 0) {
    if (await tryAcquireRequestSlot(db, supplierConnectionId)) {
      try {
        await adapter.subscribeProducts(
          supplierConnectionId,
          toSubscribe.map((row) => row.externalProductId),
        );
        await markSubscriptionsObserved(db, {
          ids: toSubscribe.map((row) => row.id),
          observedState: 'SUBSCRIBED',
        });
        subscribed = toSubscribe.length;
      } catch {
        failed += toSubscribe.length;
        await markSubscriptionAttemptFailed(db, {
          ids: toSubscribe.map((row) => row.id),
          errorCode: 'SUBSCRIBE_FAILED',
          nextRetryAt: new Date(Date.now() + RETRY_DELAY_MS),
        });
      }
    }
  }

  if (toUnsubscribe.length > 0) {
    if (await tryAcquireRequestSlot(db, supplierConnectionId)) {
      try {
        await adapter.unsubscribeProducts(
          supplierConnectionId,
          toUnsubscribe.map((row) => row.externalProductId),
        );
        await markSubscriptionsObserved(db, {
          ids: toUnsubscribe.map((row) => row.id),
          observedState: 'UNSUBSCRIBED',
        });
        unsubscribed = toUnsubscribe.length;
      } catch {
        failed += toUnsubscribe.length;
        await markSubscriptionAttemptFailed(db, {
          ids: toUnsubscribe.map((row) => row.id),
          errorCode: 'UNSUBSCRIBE_FAILED',
          nextRetryAt: new Date(Date.now() + RETRY_DELAY_MS),
        });
      }
    }
  }

  return { subscribed, unsubscribed, failed };
}
