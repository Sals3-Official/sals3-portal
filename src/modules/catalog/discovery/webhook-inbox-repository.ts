import { and, eq, sql } from 'drizzle-orm';
import type { DbExecutor } from '@/lib/db/client';
import { webhookInbox, type WebhookInboxRow } from '@/lib/db/schema';

/**
 * Deduplicated webhook event inbox. The HTTP route inserts (post-signature-
 * verification) and the WEBHOOK_EVENT queue handler processes - never the
 * other way around, so the HTTP path stays fast enough for CJ's documented
 * 3-second acknowledgment window.
 */

export async function insertInboxEventIfAbsent(
  executor: DbExecutor,
  input: {
    supplierConnectionId: string;
    messageId: string;
    eventType: string;
    operation: string | null;
    payload: unknown;
  },
): Promise<WebhookInboxRow | null> {
  const inserted = await executor
    .insert(webhookInbox)
    .values({
      supplier: 'CJ_DROPSHIPPING',
      supplierConnectionId: input.supplierConnectionId,
      messageId: input.messageId,
      eventType: input.eventType,
      operation: input.operation,
      payload: input.payload,
    })
    .onConflictDoNothing({
      target: [webhookInbox.supplierConnectionId, webhookInbox.messageId],
    })
    .returning();

  return inserted[0] ?? null;
}

export async function findInboxEventById(
  executor: DbExecutor,
  inboxId: string,
): Promise<WebhookInboxRow | null> {
  const rows = await executor
    .select()
    .from(webhookInbox)
    .where(eq(webhookInbox.id, inboxId))
    .limit(1);

  return rows[0] ?? null;
}

/** Idempotent completion: only a PENDING row transitions to PROCESSED. */
export async function markInboxProcessed(
  executor: DbExecutor,
  inboxId: string,
): Promise<boolean> {
  const updated = await executor
    .update(webhookInbox)
    .set({ state: 'PROCESSED', processedAt: new Date() })
    .where(and(eq(webhookInbox.id, inboxId), eq(webhookInbox.state, 'PENDING')))
    .returning({ id: webhookInbox.id });

  return updated.length > 0;
}

export async function markInboxFailed(
  executor: DbExecutor,
  input: { inboxId: string; errorCode: string },
): Promise<void> {
  await executor
    .update(webhookInbox)
    .set({
      state: 'FAILED',
      attempts: sql`${webhookInbox.attempts} + 1`,
      lastErrorCode: input.errorCode,
    })
    .where(eq(webhookInbox.id, input.inboxId));
}
