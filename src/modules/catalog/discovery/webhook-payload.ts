import { z } from 'zod';

/**
 * Strict validation of a decoded CJ webhook body (post-signature-
 * verification). Documented envelope: `messageId`, `type` (PRODUCT,
 * VARIANT, STOCK, ...), `messageType` (INSERT/UPDATE/DELETE), `openId`,
 * `params`. Only the product-catalogue event families are accepted here;
 * anything else is rejected before persistence.
 */

export const WEBHOOK_EVENT_TYPES = ['PRODUCT', 'VARIANT', 'STOCK'] as const;
export const WEBHOOK_OPERATIONS = ['INSERT', 'UPDATE', 'DELETE'] as const;

export const cjWebhookEnvelopeSchema = z.object({
  messageId: z.string().min(1).max(200),
  type: z.enum(WEBHOOK_EVENT_TYPES),
  messageType: z.enum(WEBHOOK_OPERATIONS).optional(),
  openId: z.union([z.string(), z.number()]).optional(),
  params: z.unknown().optional(),
});

export type CjWebhookEnvelope = z.infer<typeof cjWebhookEnvelopeSchema>;

/**
 * The minimal, validated fields the WEBHOOK_EVENT handler needs. Raw params
 * are reduced to this shape before persistence - the inbox never stores the
 * full raw body.
 */
export const webhookEventPayloadSchema = z.object({
  pid: z.string().max(200).optional(),
  vid: z.string().max(200).optional(),
});

export type WebhookEventPayload = z.infer<typeof webhookEventPayloadSchema>;

/** Extracts the product/variant identity from validated params, tolerantly. */
export function extractEventPayload(params: unknown): WebhookEventPayload {
  if (typeof params !== 'object' || params === null) return {};

  const record = params as Record<string, unknown>;
  const pid = typeof record.pid === 'string' ? record.pid : undefined;
  const vid = typeof record.vid === 'string' ? record.vid : undefined;

  return webhookEventPayloadSchema.parse({ pid, vid });
}
