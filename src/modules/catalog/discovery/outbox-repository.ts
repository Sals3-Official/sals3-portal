import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { Database, DbExecutor } from '@/lib/db/client';
import { workOutbox, type WorkOutboxRow } from '@/lib/db/schema';
import { MAX_OUTBOX_ATTEMPTS, OUTBOX_LEASE_MS } from './config';
import type { QueueMessage, QueueOperation } from './messages';

/**
 * Durable work outbox (ADR-013 §12). A handler persists successor intent in
 * the SAME transaction as its state change; `dispatchOutbox` (see
 * `outbox-dispatch.ts`) later publishes each row to the queue and confirms
 * it here with an exact compare-and-swap on the lease token. Database state
 * and successor intent therefore cannot silently diverge: a crash between
 * commit and publish leaves a visible PENDING row that any later drain
 * re-publishes, and the queue-side idempotency key absorbs the duplicate.
 */

export type OutboxIntent = {
  message: QueueMessage;
  /** Queue delay for this successor, seconds. */
  delaySeconds?: number;
};

/**
 * Owner intake priority for broad CJ `product/list` waves (2026-08-12):
 * Trending (`searchType=2`), then Most listed (`listedNum desc`), then
 * bounded New arrivals (`createAt desc`), then the coverage partition scanner.
 * Non-discovery maintenance/evaluation work stays ahead so active waves can
 * drain and open the next 600 products.
 */
const OUTBOX_CLAIM_PRIORITY = sql`
  CASE
    WHEN ${workOutbox.operation} = 'FULFILL_ORDER' THEN 0
    WHEN ${workOutbox.operation} = 'EVALUATE_CANDIDATE' THEN 1
    WHEN ${workOutbox.operation} = 'RECONCILE_PRODUCT' THEN 2
    WHEN ${workOutbox.operation} = 'WEBHOOK_EVENT' THEN 3
    WHEN ${workOutbox.operation} = 'DISCOVERY_CURATED_LANE'
      AND ${workOutbox.payload}->>'lane' = 'CJ_TRENDING' THEN 10
    WHEN ${workOutbox.operation} = 'DISCOVERY_CURATED_LANE'
      AND ${workOutbox.payload}->>'lane' = 'CJ_MOST_LISTED' THEN 20
    WHEN ${workOutbox.operation} = 'DISCOVERY_CURATED_LANE'
      AND ${workOutbox.payload}->>'lane' = 'CJ_NEW_ARRIVALS' THEN 30
    WHEN ${workOutbox.operation} = 'DISCOVERY_PARTITION' THEN 40
    WHEN ${workOutbox.operation} = 'DISCOVERY_AUDIT_UNIT' THEN 50
    WHEN ${workOutbox.operation} = 'DISCOVERY_CYCLE_START' THEN 60
    ELSE 70
  END
`;

/**
 * Insert successor intents inside the caller's transaction. Conflicts on
 * `idempotency_key` are silently skipped: the same logical successor can
 * only ever be recorded once, however many at-least-once deliveries try.
 */
export async function insertOutboxIntents(
  executor: DbExecutor,
  intents: OutboxIntent[],
): Promise<void> {
  if (intents.length === 0) return;

  await executor
    .insert(workOutbox)
    .values(
      intents.map((intent) => ({
        operation: intent.message.operation,
        payload: intent.message,
        idempotencyKey: intent.message.idempotencyKey,
        notBefore:
          intent.delaySeconds === undefined || intent.delaySeconds <= 0
            ? null
            : new Date(Date.now() + intent.delaySeconds * 1000),
      })),
    )
    .onConflictDoNothing({ target: workOutbox.idempotencyKey });
}

/**
 * Claims a bounded batch of dispatchable rows for one dispatcher: every
 * PENDING row whose lease is free or expired - INCLUDING rows whose
 * `notBefore` lies in the future. A delayed successor is published to the
 * transport IMMEDIATELY with `delaySeconds`; the transport holds it until
 * due (Vercel Queues delayed delivery). Gating the claim on `notBefore`
 * would strand every delayed sweep/retry/next-cycle row, because nothing
 * wakes the dispatcher once the queue goes quiet - the chain-stall defect
 * the Codex review caught.
 *
 * `FOR UPDATE SKIP LOCKED` keeps two concurrent drains from claiming the
 * same row; attempts increment at claim time so a dispatcher crash still
 * counts against the bounded retry budget.
 */
export async function claimDispatchableOutbox(
  db: Database,
  input: {
    leaseToken: string;
    batchSize: number;
    idempotencyKeys?: string[];
    operations?: QueueOperation[];
  },
): Promise<WorkOutboxRow[]> {
  return db.transaction(async (tx) => {
    const now = new Date();
    const filters = [
      eq(workOutbox.state, 'PENDING'),
      or(isNull(workOutbox.leasedUntil), lte(workOutbox.leasedUntil, now)),
    ];

    if (
      input.idempotencyKeys !== undefined &&
      input.idempotencyKeys.length > 0
    ) {
      filters.push(inArray(workOutbox.idempotencyKey, input.idempotencyKeys));
    }

    if (input.operations !== undefined && input.operations.length > 0) {
      filters.push(inArray(workOutbox.operation, input.operations));
    }

    const claimable = await tx
      .select({ id: workOutbox.id })
      .from(workOutbox)
      .where(and(...filters))
      .orderBy(OUTBOX_CLAIM_PRIORITY, asc(workOutbox.createdAt))
      .limit(input.batchSize)
      .for('update', { skipLocked: true });

    if (claimable.length === 0) return [];

    return tx
      .update(workOutbox)
      .set({
        leaseToken: input.leaseToken,
        leasedUntil: new Date(now.getTime() + OUTBOX_LEASE_MS),
        attempts: sql`${workOutbox.attempts} + 1`,
        updatedAt: now,
      })
      .where(
        inArray(
          workOutbox.id,
          claimable.map((row) => row.id),
        ),
      )
      .returning();
  });
}

/** Confirms one row as published - exact CAS on id + lease token. */
export async function markOutboxDispatched(
  executor: DbExecutor,
  input: { id: string; leaseToken: string },
): Promise<void> {
  await executor
    .update(workOutbox)
    .set({
      state: 'DISPATCHED',
      dispatchedAt: new Date(),
      leaseToken: null,
      leasedUntil: null,
      lastErrorCode: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(workOutbox.id, input.id),
        eq(workOutbox.leaseToken, input.leaseToken),
      ),
    );
}

/**
 * Records a failed publish attempt: back to PENDING while under the bounded
 * budget, then a visible FAILED state - never a silent drop.
 *
 * `notBefore` is deliberately NOT touched: it is the message's scheduled
 * delivery time (sent to the transport as `delaySeconds`), not a publish-
 * retry clock. Re-attempt pacing comes from the failed drain itself - the
 * dispatcher throws, the incoming queue delivery goes unacknowledged, and
 * the transport's redelivery backoff times the next drain.
 */
export async function releaseOutboxAttempt(
  executor: DbExecutor,
  input: {
    id: string;
    leaseToken: string;
    attempts: number;
    errorCode: string;
  },
): Promise<void> {
  const exhausted = input.attempts >= MAX_OUTBOX_ATTEMPTS;

  await executor
    .update(workOutbox)
    .set({
      state: exhausted ? 'FAILED' : 'PENDING',
      leaseToken: null,
      leasedUntil: null,
      lastErrorCode: input.errorCode,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(workOutbox.id, input.id),
        eq(workOutbox.leaseToken, input.leaseToken),
      ),
    );
}

/** Operational visibility: pending/failed depth and the oldest pending age. */
export async function summarizeOutbox(executor: DbExecutor): Promise<{
  pending: number;
  failed: number;
  oldestPendingAt: Date | null;
}> {
  const rows = await executor
    .select({
      state: workOutbox.state,
      total: sql<number>`count(*)`,
      oldest: sql<Date | string | null>`min(${workOutbox.createdAt})`,
    })
    .from(workOutbox)
    .where(or(eq(workOutbox.state, 'PENDING'), eq(workOutbox.state, 'FAILED')))
    .groupBy(workOutbox.state);

  let pending = 0;
  let failed = 0;
  let oldestPendingAt: Date | null = null;

  rows.forEach((row) => {
    if (row.state === 'PENDING') {
      pending = Number(row.total);
      if (row.oldest === null) {
        oldestPendingAt = null;
      } else {
        oldestPendingAt =
          row.oldest instanceof Date ? row.oldest : new Date(row.oldest);
      }
    }
    if (row.state === 'FAILED') failed = Number(row.total);
  });

  return { pending, failed, oldestPendingAt };
}
