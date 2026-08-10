import getDb from '@/lib/db/client';
import resolveBuyerDestinationCountryPolicy from '@/lib/country-policy/buyer-destination-country';
import {
  appendAuditEvent,
  findCandidateByConnectionAndExternalId,
  requeueForSourceChange,
} from '../candidates/repository';
import {
  composeEvaluationPolicyVersion,
  POLICY_VERSION,
} from '../candidates/rules/policy';
import type { WebhookEventMessage } from './messages';
import { webhookEventPayloadSchema } from './webhook-payload';
import {
  findInboxEventById,
  markInboxFailed,
  markInboxProcessed,
} from './webhook-inbox-repository';
import { insertOutboxIntents } from './outbox-repository';
import { recordDiscoveryFailure } from './failure-repository';

/**
 * WEBHOOK_EVENT: processes one verified, deduplicated inbox event - OUTSIDE
 * the webhook HTTP request, which only persisted and acknowledged. PRODUCT,
 * VARIANT, and STOCK INSERT/UPDATE/DELETE all reduce to the same idempotent
 * action: requeue the affected candidate for a fresh evaluation (admission
 * `MATERIAL_SOURCE_CHANGE`), whose evidence fetch observes whatever actually
 * changed or disappeared. Duplicate deliveries find the inbox row already
 * PROCESSED, or the requeue matches nothing - either way a no-op.
 */
export default async function handleWebhookEvent(
  message: WebhookEventMessage,
): Promise<void> {
  const db = getDb();
  const event = await findInboxEventById(db, message.inboxId);

  if (event === null || event.state !== 'PENDING') return;

  const payload = webhookEventPayloadSchema.safeParse(event.payload);

  if (!payload.success) {
    await markInboxFailed(db, {
      inboxId: event.id,
      errorCode: 'WEBHOOK_PAYLOAD_INVALID',
    });
    await recordDiscoveryFailure(db, {
      scope: 'WEBHOOK_EVENT',
      referenceId: event.id,
      errorCode: 'WEBHOOK_PAYLOAD_INVALID',
    });
    return;
  }

  const { pid } = payload.data;

  if (pid === undefined || pid === '') {
    // STOCK events key on variant ids; without a variant->product reference
    // table there is no safe mapping to a candidate yet. Record the gap
    // visibly (never guess an identity) and complete the event - the
    // freshness tiers still reconcile the affected product on schedule.
    await recordDiscoveryFailure(db, {
      scope: 'WEBHOOK_EVENT',
      referenceId: event.id,
      errorCode: 'WEBHOOK_EVENT_UNMAPPED',
      detail: `No product id on a ${event.eventType} event; variant-level mapping is a documented follow-up.`,
    });
    await markInboxProcessed(db, event.id);
    return;
  }

  const candidate = await findCandidateByConnectionAndExternalId(
    db,
    event.supplierConnectionId,
    pid,
  );

  if (candidate === null) {
    // Never discovered through this connection yet - the next discovery
    // cycle picks it up; a webhook event alone carries no feed snapshot to
    // admit it from.
    await markInboxProcessed(db, event.id);
    return;
  }

  const policyVersion = composeEvaluationPolicyVersion(
    POLICY_VERSION,
    resolveBuyerDestinationCountryPolicy().policyVersion,
  );

  await db.transaction(async (tx) => {
    const requeued = await requeueForSourceChange(tx, candidate.id);

    await appendAuditEvent(tx, {
      actorId: 'system:cj-webhook',
      action: 'CANDIDATE_WEBHOOK_EVENT_PROCESSED',
      entityType: 'supplier_candidate',
      entityId: candidate.id,
      payload: {
        inboxId: event.id,
        eventType: event.eventType,
        operation: event.operation,
        requeued,
      },
    });

    if (requeued) {
      await insertOutboxIntents(tx, [
        {
          message: {
            v: 1,
            operation: 'EVALUATE_CANDIDATE',
            idempotencyKey: `evaluate:${candidate.id}:webhook:${event.id}`,
            candidateId: candidate.id,
            policyVersion,
            admissionReason: 'MATERIAL_SOURCE_CHANGE',
          },
        },
      ]);
    }

    await markInboxProcessed(tx, event.id);
  });
}
