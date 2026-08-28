import 'server-only';

import { createHash } from 'node:crypto';
import { and, eq, isNotNull, lt, or, isNull, asc, sql } from 'drizzle-orm';
import { z } from 'zod';
import getDb, { type DbExecutor } from '@/lib/db/client';
import { fulfillmentGroups, parcelTrackingEvents } from '@/lib/db/schema';
import PostgresSupplierSecretStore from '@/lib/secrets/postgres-supplier-secret-store';
import CjTokenManager from '@/modules/suppliers/providers/cj/cj-auth';
import { getCjJson } from './cj-http';
import { PARCEL_LIFECYCLE_STATES } from './contracts';
import {
  parseCjOrderStatus,
  parcelStateFromCj,
  reconcileDelivery,
  type CjSubStatus,
} from './cj-status';

/**
 * Pulls each in-flight fulfillment group's status and tracking out of CJ and
 * persists them, so the buyer read API answers from the database and never
 * calls a supplier on a page view.
 *
 * ## Why a pull, when a webhook receiver exists
 *
 * `/api/webhooks/cj` verifies and inboxes CJ's push events, but CJ disables a
 * webhook after two hours below 80% success and pushes nothing for a parcel
 * whose carrier simply went quiet. A bounded periodic pull is the floor the
 * buyer surface can rely on; webhook-driven updates can only make it fresher.
 *
 * ## What it writes, and what it refuses to
 *
 * - `parcelState` — always through `parcelStateFromCj` + `reconcileDelivery`.
 *   Raw CJ vocabulary never lands in the column (ADR-004 §2), and a carrier
 *   "delivered" that CJ disputes becomes `TRACKING_CONFLICT`, never a silent
 *   downgrade (§5).
 * - `trackingNumber` — CJ's `trackNumber`, once it exists.
 * - `parcel_tracking_events` — appended idempotently: the dedupe key is a hash
 *   of (source, occurred-at, label), because CJ's track feed returns the full
 *   history on every call.
 *
 * A group whose CJ call fails is skipped and left due — `lastSyncedAt` is only
 * advanced on success, so the next run retries it. One failing group cannot
 * poison the batch.
 */

/** Groups per run. Bounded so the route stays inside its maxDuration. */
const SYNC_BATCH_SIZE = 25;

/** A group is due when it has never synced or its last sync is older than this. */
const SYNC_STALE_MINUTES = 20;

/**
 * `/shopping/order/getOrderDetail`. Only the fields the sync reads — CJ's
 * payload is far wider and drifts; everything else passes through unparsed.
 */
const orderDetailSchema = z.object({
  orderStatus: z.string().nullish(),
  orderSubStatus: z.string().nullish(),
  trackNumber: z.string().nullish(),
  logisticName: z.string().nullish(),
});

/** `/logistic/getTrackInfo`. One row per carrier scan. */
const trackInfoSchema = z.array(
  z.object({
    trackingStatus: z.string().nullish(),
    content: z.string().nullish(),
    date: z.string().nullish(),
  }),
);

export type StatusSyncResult = {
  scanned: number;
  updated: number;
  eventsInserted: number;
  failed: number;
};

type SyncGroup = typeof fulfillmentGroups.$inferSelect;

function dedupeKeyOf(source: string, occurredAt: string, label: string) {
  return createHash('sha256')
    .update(`${source}\n${occurredAt}\n${label}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * CJ's track feed timestamps are `YYYY-MM-DD HH:mm:ss` with no zone; CJ
 * documents them as UTC+8. A row whose date cannot be read is kept with the
 * sync time rather than dropped — a scan with a bad clock is still a scan.
 */
function parseCjTrackDate(
  raw: string | null | undefined,
  fallback: Date,
): Date {
  if (raw === null || raw === undefined || raw.trim() === '') return fallback;

  const candidate = new Date(`${raw.replace(' ', 'T')}+08:00`);

  return Number.isNaN(candidate.getTime()) ? fallback : candidate;
}

function isKnownParcelState(value: string): boolean {
  return (PARCEL_LIFECYCLE_STATES as readonly string[]).includes(value);
}

/**
 * Groups the sync considers in-flight. Terminal parcels (delivered, cancelled,
 * refunded, returned — the literal list in the SQL below) are left alone:
 * their state cannot advance, and syncing them forever would spend CJ quota on
 * parcels nobody is waiting for.
 */
async function dueGroups(executor: DbExecutor): Promise<SyncGroup[]> {
  const staleBefore = new Date(Date.now() - SYNC_STALE_MINUTES * 60_000);

  return executor
    .select()
    .from(fulfillmentGroups)
    .where(
      and(
        isNotNull(fulfillmentGroups.cjOrderId),
        or(
          isNull(fulfillmentGroups.parcelState),
          sql`${fulfillmentGroups.parcelState} not in ('DELIVERED', 'CANCELLED', 'REFUNDED', 'RETURNED')`,
        ),
        or(
          isNull(fulfillmentGroups.lastSyncedAt),
          lt(fulfillmentGroups.lastSyncedAt, staleBefore),
        ),
      ),
    )
    .orderBy(asc(fulfillmentGroups.lastSyncedAt))
    .limit(SYNC_BATCH_SIZE);
}

async function syncGroup(
  executor: DbExecutor,
  group: SyncGroup,
  tokenManager: CjTokenManager,
  now: Date,
): Promise<{ updated: boolean; eventsInserted: number }> {
  const detailRaw = await getCjJson(
    group.supplierConnectionId,
    `/shopping/order/getOrderDetail?orderId=${encodeURIComponent(group.cjOrderId ?? '')}`,
    tokenManager,
  );
  const detail = orderDetailSchema.parse(detailRaw ?? {});

  const cjStatus =
    detail.orderStatus === null || detail.orderStatus === undefined
      ? null
      : parseCjOrderStatus(detail.orderStatus);
  const subStatus: CjSubStatus | null =
    detail.orderSubStatus === 'PENDING' ||
    detail.orderSubStatus === 'PROCESSING'
      ? detail.orderSubStatus
      : null;

  // Funding readiness is the fulfillment worker's concern; by the time a group
  // has a cjOrderId the supplier payment either went through or the worker
  // marked AWAITING_SUPPLIER_FUNDS in `status`. READY keeps the mapping from
  // re-inventing that judgement here.
  const supplierState =
    cjStatus === null ? null : parcelStateFromCj(cjStatus, subStatus, 'READY');

  const trackingNumber = detail.trackNumber?.trim() || group.trackingNumber;
  let eventsInserted = 0;
  let carrierReportsDelivered = group.carrierDeliveredAt !== null;
  let { carrierDeliveredAt } = group;

  if (trackingNumber !== null && trackingNumber !== undefined) {
    let trackRows: z.infer<typeof trackInfoSchema> = [];

    try {
      const trackRaw = await getCjJson(
        group.supplierConnectionId,
        `/logistic/getTrackInfo?trackNumber=${encodeURIComponent(trackingNumber)}`,
        tokenManager,
      );
      trackRows = trackInfoSchema.parse(trackRaw ?? []);
    } catch {
      // The order detail is still worth persisting when the track feed is
      // down; events simply arrive on a later run.
      trackRows = [];
    }

    // Insert oldest-first so createdAt ordering matches scan ordering.
    const rows = [...trackRows]
      .reverse()
      .map((row) => ({
        label: (row.content ?? row.trackingStatus ?? '').trim(),
        occurredAt: parseCjTrackDate(row.date, now),
        delivered: (row.trackingStatus ?? '')
          .toUpperCase()
          .includes('DELIVERED'),
      }))
      .filter((row) => row.label !== '');

    const firstDelivered = rows.find((row) => row.delivered);

    if (firstDelivered !== undefined && carrierDeliveredAt === null) {
      carrierDeliveredAt = firstDelivered.occurredAt;
      carrierReportsDelivered = true;
    }

    /* eslint-disable no-await-in-loop -- ordered idempotent appends: createdAt must follow scan order. */
    // eslint-disable-next-line no-restricted-syntax -- sequential by design, see above.
    for (const row of rows) {
      const inserted = await executor
        .insert(parcelTrackingEvents)
        .values({
          fulfillmentGroupId: group.id,
          source: 'CARRIER',
          label: row.label,
          occurredAt: row.occurredAt,
          isException: false,
          dedupeKey: dedupeKeyOf(
            'CARRIER',
            row.occurredAt.toISOString(),
            row.label,
          ),
        })
        .onConflictDoNothing()
        .returning({ id: parcelTrackingEvents.id });

      eventsInserted += inserted.length;
    }
    /* eslint-enable no-await-in-loop */
  }

  const nextState =
    supplierState === null
      ? group.parcelState
      : reconcileDelivery(supplierState, carrierReportsDelivered);

  await executor
    .update(fulfillmentGroups)
    .set({
      ...(nextState !== null && isKnownParcelState(nextState)
        ? { parcelState: nextState }
        : {}),
      ...(trackingNumber ? { trackingNumber } : {}),
      ...(detail.orderStatus ? { supplierStatusRaw: detail.orderStatus } : {}),
      ...(carrierDeliveredAt !== null ? { carrierDeliveredAt } : {}),
      lastSyncedAt: now,
      updatedAt: now,
    })
    .where(eq(fulfillmentGroups.id, group.id));

  return { updated: true, eventsInserted };
}

export default async function runOrderStatusSync(
  options: { executor?: DbExecutor; now?: Date } = {},
): Promise<StatusSyncResult> {
  const executor = options.executor ?? getDb();
  const now = options.now ?? new Date();
  const tokenManager = new CjTokenManager(new PostgresSupplierSecretStore());
  const groups = await dueGroups(executor);

  const result: StatusSyncResult = {
    scanned: groups.length,
    updated: 0,
    eventsInserted: 0,
    failed: 0,
  };

  /* eslint-disable no-await-in-loop -- sequential by design: one connection's rate limit must not be hit by a parallel burst. */
  // eslint-disable-next-line no-restricted-syntax -- bounded batch, sequential supplier calls.
  for (const group of groups) {
    try {
      const outcome = await syncGroup(executor, group, tokenManager, now);

      result.updated += outcome.updated ? 1 : 0;
      result.eventsInserted += outcome.eventsInserted;
    } catch {
      // Skipped, left due; lastSyncedAt was not advanced so the next run
      // retries. Never logged with the group's identifiers beyond the count —
      // the sync result is the observable.
      result.failed += 1;
    }
  }
  /* eslint-enable no-await-in-loop */

  return result;
}
