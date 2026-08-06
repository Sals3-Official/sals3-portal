import { z } from 'zod';

/**
 * Validation boundary for the CJ candidate shortlist (spec section 8.11).
 *
 * The browser supplies **only** a stable supplier identifier. Seller, actor,
 * and market context are read from the verified server session, never from
 * the request — spec section 8.13: "The browser sends intent and stable
 * identifiers, not a trusted CJ object." Nothing here accepts a CJ title,
 * price, stock, category, media, compliance, or publication value.
 */

/** Spec section 5.1: CJ is the only integrated supplier today. */
export const supplierSchema = z.literal('CJ_DROPSHIPPING');

/**
 * CJ `pid` as it reaches us from `/product/list` (see
 * `src/lib/cj/normalize.ts`). Allow-listed character set — an identifier is
 * never free text, so anything outside this shape is rejected rather than
 * escaped later.
 */
export const externalProductIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._:-]+$/, 'Supplier product id has an unexpected format');

/**
 * Format check only. Which markets are actually enabled is an ADR-003
 * business decision that no format schema can make.
 */
export const marketCodeSchema = z
  .string()
  .regex(
    /^[A-Z]{2}$/,
    'Market code must be a two-letter uppercase ISO country code',
  );

export const actorIdSchema = z.string().trim().min(1).max(128);
export const sellerIdSchema = z.string().trim().min(1).max(128);

/** What the client is allowed to send. Deliberately one field. */
export const shortlistCandidateInputSchema = z.object({
  externalProductId: externalProductIdSchema,
});

export type ShortlistCandidateInput = z.infer<
  typeof shortlistCandidateInputSchema
>;

/** Server-assembled command: client intent plus verified session context. */
export const shortlistCandidateCommandSchema = z.object({
  supplier: supplierSchema,
  externalProductId: externalProductIdSchema,
  intendedSellerId: sellerIdSchema,
  intendedMarketCodes: z.array(marketCodeSchema).min(1),
  actorId: actorIdSchema,
});

export type ShortlistCandidateCommand = z.infer<
  typeof shortlistCandidateCommandSchema
>;

export const shortlistStateSchema = z.enum([
  'SHORTLISTED',
  'PREFLIGHT_PENDING',
]);

/**
 * Result of the shortlist step. There is no `decision`, `score`, or
 * `policyVersion` field: full preflight (spec section 8.3) is not
 * implemented, so this contract cannot imply one ran.
 */
export const shortlistResultSchema = z.object({
  candidateId: z.string().uuid(),
  shortlistState: shortlistStateSchema,
  reused: z.boolean(),
});

export type ShortlistResult = z.infer<typeof shortlistResultSchema>;
