import { NextResponse, type NextRequest } from 'next/server';
import getDb, { isDatabaseConfigured } from '@/lib/db/client';
import { listWebhookSecrets } from '@/lib/secrets/webhook-secret-store';
import verifyCjWebhookSignature from '@/modules/catalog/discovery/webhook-verify';
import {
  cjWebhookEnvelopeSchema,
  extractEventPayload,
} from '@/modules/catalog/discovery/webhook-payload';
import { insertInboxEventIfAbsent } from '@/modules/catalog/discovery/webhook-inbox-repository';
import { insertOutboxIntents } from '@/modules/catalog/discovery/outbox-repository';
import getQueueTransport from '@/modules/catalog/discovery/queue-transport';

/**
 * POST /api/webhooks/cj - CJ webhook receiver.
 *
 * Fast path by construction (CJ requires a response within 3 seconds and
 * disables a webhook after two complete hours below 80% success):
 *
 * 1. bounded read of the EXACT raw request bytes (size-capped before any
 *    heavy work);
 * 2. documented Base64 HMAC-SHA256 signature verification over those raw
 *    bytes, using each connection's stored (encrypted) CJ openId as the
 *    secret - constant-time compare, length-mismatch safe, and the secret
 *    is selected by trying stored secrets, never by trusting a body field;
 * 3. strict validation of the decoded JSON;
 * 4. messageId-deduplicated inbox insert + durable WEBHOOK_EVENT outbox
 *    intent in one transaction;
 * 5. HTTP 200 for accepted AND duplicate events.
 *
 * No supplier lookup or evaluation happens here - the queue handler does
 * the heavy work later. Invalid signatures are rejected without persistence
 * or queueing. The signature, openId, and raw body are never logged.
 */
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 10;

const NO_STORE = { 'Cache-Control': 'private, no-store' };
/** Conservative request-size ceiling, enforced before heavy processing. */
const MAX_BODY_BYTES = 256 * 1024;

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { code: 503, result: 'error', message: 'unavailable' },
      { status: 503, headers: NO_STORE },
    );
  }

  const declaredLength = Number(request.headers.get('content-length') ?? '0');

  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { code: 413, result: 'error', message: 'too large' },
      { status: 413, headers: NO_STORE },
    );
  }

  const rawBody = Buffer.from(await request.arrayBuffer());

  if (rawBody.byteLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { code: 413, result: 'error', message: 'too large' },
      { status: 413, headers: NO_STORE },
    );
  }

  const signature = request.headers.get('sign') ?? '';

  if (signature === '') {
    return NextResponse.json(
      { code: 401, result: 'error', message: 'unauthorized' },
      { status: 401, headers: NO_STORE },
    );
  }

  // Try each stored secret (bounded: one per supplier connection). The
  // matching secret identifies the connection - a body-supplied openId is
  // never trusted to select it.
  let matchedConnectionId: string | null = null;

  try {
    const secrets = await listWebhookSecrets(getDb());

    // eslint-disable-next-line no-restricted-syntax -- bounded by connection count; every candidate is checked in constant time.
    for (const candidate of secrets) {
      if (
        verifyCjWebhookSignature({
          rawBody,
          signatureHeader: signature,
          secret: candidate.secret,
        })
      ) {
        matchedConnectionId = candidate.connectionId;
      }
    }
  } catch {
    return NextResponse.json(
      { code: 503, result: 'error', message: 'unavailable' },
      { status: 503, headers: NO_STORE },
    );
  }

  if (matchedConnectionId === null) {
    // Invalid signature: reject without persistence, queueing, or logging
    // of the signature/body.
    return NextResponse.json(
      { code: 401, result: 'error', message: 'unauthorized' },
      { status: 401, headers: NO_STORE },
    );
  }

  // Parse the JSON from the exact verified bytes.
  let decoded: unknown;

  try {
    decoded = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return NextResponse.json(
      { code: 400, result: 'error', message: 'invalid payload' },
      { status: 400, headers: NO_STORE },
    );
  }

  const envelope = cjWebhookEnvelopeSchema.safeParse(decoded);

  if (!envelope.success) {
    return NextResponse.json(
      { code: 400, result: 'error', message: 'invalid payload' },
      { status: 400, headers: NO_STORE },
    );
  }

  const payload = extractEventPayload(envelope.data.params);
  const db = getDb();
  let inboxId: string | null = null;

  try {
    await db.transaction(async (tx) => {
      const inserted = await insertInboxEventIfAbsent(tx, {
        supplierConnectionId: matchedConnectionId!,
        messageId: envelope.data.messageId,
        eventType: envelope.data.type,
        operation: envelope.data.messageType ?? null,
        payload,
      });

      if (inserted === null) return; // Duplicate messageId - already accepted.

      inboxId = inserted.id;

      await insertOutboxIntents(tx, [
        {
          message: {
            v: 1,
            operation: 'WEBHOOK_EVENT',
            idempotencyKey: `webhook:${matchedConnectionId}:${envelope.data.messageId}`,
            inboxId: inserted.id,
            supplierConnectionId: matchedConnectionId!,
          },
        },
      ]);
    });
  } catch {
    // Persistence failed: report a retryable error so CJ redelivers.
    return NextResponse.json(
      { code: 500, result: 'error', message: 'persist failed' },
      { status: 500, headers: NO_STORE },
    );
  }

  if (inboxId !== null) {
    // Best-effort immediate publish of the successor; the event is already
    // durable, so a publish failure only delays processing until the next
    // outbox drain.
    try {
      await getQueueTransport().publish(
        {
          v: 1,
          operation: 'WEBHOOK_EVENT',
          idempotencyKey: `webhook:${matchedConnectionId}:${envelope.data.messageId}`,
          inboxId,
          supplierConnectionId: matchedConnectionId,
        },
        {
          idempotencyKey: `webhook:${matchedConnectionId}:${envelope.data.messageId}`,
        },
      );
    } catch {
      // Drained later; never fail the acknowledgment for this.
    }
  }

  return NextResponse.json(
    { code: 200, result: 'success', message: 'ok' },
    { headers: NO_STORE },
  );
}
