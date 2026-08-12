import { z } from 'zod';

/**
 * Server-side validation for every governance input.
 *
 * These schemas are the boundary even though no browser can reach the
 * operations today (see `authorization.ts`). Validating at the function
 * boundary rather than at a future route handler means the rules travel with
 * the operation: whichever surface eventually calls it inherits the same
 * allow lists instead of re-deriving weaker ones.
 *
 * Note what is *not* accepted anywhere below: a category display label, a
 * category path to match on, a similarity score, or a `NAME_SIMILARITY`
 * method. A Sals3 category can only be named by its stable universal code,
 * and the code is then looked up — a code that does not exist is rejected,
 * never created.
 */

const SALS3_CATEGORY_CODE = z
  .string()
  .trim()
  .min(1)
  .max(64)
  // The workbook's stable code shape (`CAT-DIG-100801`). An allow list, so a
  // path fragment or a free-text label cannot arrive in this field at all.
  .regex(/^[A-Z0-9-]+$/, 'Not a Sals3 universal category code');

const EXTERNAL_CATEGORY_ID = z.string().trim().min(1).max(128);

const REASON = z.string().trim().min(8).max(500);

export const proposeCategoryMappingSchema = z
  .object({
    provider: z.literal('CJ_DROPSHIPPING'),
    externalCategoryId: EXTERNAL_CATEGORY_ID,
    /** Snapshot for the reviewer. Optional, and never used to select a category. */
    observedCategoryPath: z.string().trim().max(1_000).nullable().default(null),
    taxonomyVersion: z.string().trim().min(1).max(64),
    method: z.enum(['EXTERNAL_ID_RULE', 'REVIEWED_PATH_RULE']),
    confidence: z.enum(['EXACT', 'ACCEPTABLE', 'AMBIGUOUS', 'UNMAPPED']),
    /** Required for `EXACT`/`ACCEPTABLE`; forbidden otherwise — see `superRefine`. */
    sals3CategoryCode: SALS3_CATEGORY_CODE.nullable().default(null),
    reason: REASON,
    evidenceReference: z.string().trim().max(500).nullable().default(null),
    actorId: z.string().trim().min(1).max(128),
    /**
     * The version the caller believes is currently the highest for this
     * identity. `0` means "I believe none exists". A mismatch is a stale
     * write, not a new proposal.
     */
    expectedCurrentVersion: z.number().int().min(0),
  })
  .superRefine((value, ctx) => {
    const confident =
      value.confidence === 'EXACT' || value.confidence === 'ACCEPTABLE';

    if (confident && value.sals3CategoryCode === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['sals3CategoryCode'],
        message: 'A confident mapping must name a Sals3 category code.',
      });
    }

    // The mirror image matters just as much: an ambiguous or unmapped rule
    // that still carries a category is how a "best guess" leaks into a field
    // some later caller reads without checking confidence.
    if (!confident && value.sals3CategoryCode !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['sals3CategoryCode'],
        message:
          'An ambiguous or unmapped decision must not name a Sals3 category code.',
      });
    }
  });

export type ProposeCategoryMappingInput = z.input<
  typeof proposeCategoryMappingSchema
>;
export type ProposeCategoryMappingValues = z.output<
  typeof proposeCategoryMappingSchema
>;

export const reviewCategoryMappingSchema = z.object({
  mappingId: z.uuid(),
  /** Compare-and-set token: the version the reviewer actually looked at. */
  expectedMappingVersion: z.number().int().min(1),
  decision: z.enum(['APPROVE_AND_ACTIVATE', 'REJECT']),
  reason: REASON,
  reviewedBy: z.string().trim().min(1).max(128),
});

export type ReviewCategoryMappingInput = z.infer<
  typeof reviewCategoryMappingSchema
>;
