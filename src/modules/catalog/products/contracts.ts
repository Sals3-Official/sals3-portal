import { z } from 'zod';

import { SALS3_CATEGORY_L1_OPTIONS } from '@/lib/seller-center/product-editor/sals3-category-l1';
import { descriptionDocumentSchema } from './description-document';

/**
 * Zod contracts and the honest vocabulary for the candidate-to-draft flow.
 *
 * Two rules shape every schema here. Nothing that identifies a tenant is
 * accepted from the browser — there is no `sellerAccountId`, `actorId`,
 * `productId`-to-adopt, `marketCode`, `price`, `policyVersion`, or
 * `revisionNumber` field anywhere, because every one of those is resolved
 * server-side from the session or from persisted state. And nothing here
 * expresses success: a draft that could not be completed reports exactly
 * *which* requirement is absent rather than rounding up to "ready".
 */

/** Ceiling that keeps a replayed key from being an unbounded string. */
const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(MAX_IDEMPOTENCY_KEY_LENGTH)
  .regex(
    /^[A-Za-z0-9._:-]+$/,
    'Idempotency keys use letters, digits, and . _ : - only.',
  );

export const createProductDraftInputSchema = z.object({
  /** The only resource reference the browser supplies. Ownership is re-checked server-side. */
  candidateId: z.string().uuid(),
  idempotencyKey: idempotencyKeySchema,
});

export type CreateProductDraftInput = z.infer<
  typeof createProductDraftInputSchema
>;

export const bulkCreateProductDraftsInputSchema = z.object({
  requests: z
    .array(
      z.object({
        candidateId: z.string().uuid(),
        idempotencyKey: idempotencyKeySchema,
      }),
    )
    .min(1)
    .max(5),
});

export type BulkCreateProductDraftsInput = z.infer<
  typeof bulkCreateProductDraftsInputSchema
>;

const MAX_TITLE_LENGTH = 200;

export const sals3CategoryL1Schema = z.enum(SALS3_CATEGORY_L1_OPTIONS);

export const saveProductDraftInputSchema = z.object({
  productId: z.string().uuid(),
  revisionId: z.string().uuid(),
  /** Optimistic concurrency: the revision version the editor actually rendered. */
  expectedRevisionVersion: z.number().int().positive(),
  title: z.string().trim().min(3).max(MAX_TITLE_LENGTH),
  sals3CategoryL1: sals3CategoryL1Schema,
  descriptionDocument: descriptionDocumentSchema,
  variantRetailPrices: z.array(
    z.object({
      variantId: z.string().uuid(),
      amountMinor: z.number().int().positive(),
      currency: z
        .string()
        .trim()
        .regex(/^[A-Z]{3}$/),
    }),
  ),
});

export type SaveProductDraftInput = z.infer<typeof saveProductDraftInputSchema>;

/**
 * Why a draft is not yet a complete, listable product.
 *
 * These are deliberately *requirements*, not errors: the draft is a real,
 * correct, persisted record, and each code names one thing that genuinely
 * does not exist yet in this system. Rounding any of them into a silent pass
 * is exactly what
 * `cj-candidate-to-sals3-product-draft-implementation-spec.md` §26 and
 * ADR-010 §1 forbid.
 */
export const DRAFT_MISSING_REQUIREMENTS = [
  /**
   * The candidate never reached the CJ evidence fetch — a screening-stage
   * block spends no evidence call by design — so no variants, costs, or
   * stock exist to build from. A summary-only candidate must never be used
   * to invent a variant or a CJ `vid`.
   */
  'NO_PERSISTED_SUPPLIER_EVIDENCE',
  /** Evidence exists but carries no variants; nothing sellable can be modelled. */
  'NO_SUPPLIER_VARIANTS_IN_EVIDENCE',
  /**
   * The CJ-to-Sals3 taxonomy crosswalk has no `ACTIVE`, `APPROVED` mapping for
   * this product's provider category — or has one whose confidence is
   * `AMBIGUOUS`/`UNMAPPED`, or a version that has since been superseded.
   * Without a category there is no ADR-015 category policy, so no price can
   * resolve.
   *
   * Corrected 2026-08-14: this said "No CJ-to-Sals3 taxonomy crosswalk exists
   * (spec §26)", which stopped being true when the mapping pilot shipped
   * `modules/catalog/taxonomy/`. Draft creation now asks that resolver, so this
   * code means "no approved mapping covers this category", not "no crosswalk
   * was ever built".
   */
  'CATEGORY_MAPPING_REQUIRED',
  /** Each CJ variant carries one unstructured label; Sals3 option axes are unmapped. */
  'PRODUCT_OPTIONS_UNMAPPED',
  /** The ADR-015 resolver declined to price. The exact reason is reported alongside. */
  'PRICING_UNRESOLVED',
  /** The seller has no ACTIVE market profile for a currently authorized destination. */
  'NO_ACTIVE_MARKET_PROFILE',
  /** The owning supplier connection is not CONNECTED/DEGRADED, so no binding is truthful. */
  'SUPPLIER_CONNECTION_UNHEALTHY',
  /**
   * No supplier image address is stored for this candidate, so there is no
   * media provenance to record and nothing publishable.
   *
   * Corrected 2026-08-14: this said stored evidence "records a usable-image
   * *count*, never the image URLs". That stopped being true with
   * `cj-evidence-v3`, and the discovery feed snapshot always carried an
   * `imageUrl`. Draft creation now projects both into
   * `product_media_sources`, so this code means the database genuinely holds no
   * address for this candidate.
   */
  'MEDIA_SOURCE_NOT_RECORDED',
  /** The structured description is still empty; supplier HTML is never copied in. */
  'STRUCTURED_DESCRIPTION_REQUIRED',
  /**
   * The canonical product for this CJ `pid` already exists and another seller
   * account owns its editorial record (ADR-006: two Dropshippers may source
   * one provider product). This requester gets offers, never the draft.
   */
  'EDITORIAL_RECORD_STEWARDED_BY_ANOTHER_SELLER',
] as const;

export const draftMissingRequirementSchema = z.enum(DRAFT_MISSING_REQUIREMENTS);
export type DraftMissingRequirement = z.infer<
  typeof draftMissingRequirementSchema
>;

export const DRAFT_MISSING_REQUIREMENT_EXPLANATIONS: Record<
  DraftMissingRequirement,
  string
> = {
  NO_PERSISTED_SUPPLIER_EVIDENCE:
    'This candidate has no stored supplier evidence, so no variants could be created. Nothing was fetched from the supplier.',
  NO_SUPPLIER_VARIANTS_IN_EVIDENCE:
    'The stored supplier evidence lists no variants, so this draft has nothing sellable yet.',
  CATEGORY_MAPPING_REQUIRED:
    'No Sals3 category is mapped for this product. Category-driven attributes and pricing stay unavailable until one is chosen.',
  PRODUCT_OPTIONS_UNMAPPED:
    'The supplier supplies one combined option label per variant. Sals3 option names and values have not been mapped, so no variant can become active.',
  PRICING_UNRESOLVED:
    'No price was resolved. The server-owned pricing policy declined; see the recorded reason.',
  NO_ACTIVE_MARKET_PROFILE:
    'This account has no active market profile for an authorized destination, so no market offer was created.',
  SUPPLIER_CONNECTION_UNHEALTHY:
    'The supplier connection behind this candidate is not currently workable, so no fulfillment binding was recorded.',
  MEDIA_SOURCE_NOT_RECORDED:
    'No product media provenance exists. Stored supplier evidence records only how many usable images were counted, not the images themselves.',
  STRUCTURED_DESCRIPTION_REQUIRED:
    'The structured description is empty. Supplier description HTML is never copied into a Sals3 product.',
  EDITORIAL_RECORD_STEWARDED_BY_ANOTHER_SELLER:
    'This supplier product already has a Sals3 editorial record owned by another account. Your offers were created against the shared product; its content is not editable here.',
};

/**
 * What the flow actually produced. Contains identifiers and honest state
 * only — never a raw supplier payload, a credential, a connection id, or
 * another tenant's identity (spec §18: *"Responses do not expose raw supplier
 * payloads, secrets, internal stack traces, or storage paths."*).
 */
export type ProductDraftResult = {
  productId: string;
  /** Null when the requester does not steward this product's editorial record. */
  revisionId: string | null;
  variantIds: string[];
  offerIds: string[];
  /** Always `UNPUBLISHED`. Publication is a separate, unbuilt flow. */
  publicationState: 'UNPUBLISHED';
  missingRequirements: DraftMissingRequirement[];
  /** The pricing resolver's own reason when pricing did not resolve. */
  pricingUnavailableReason: string | null;
  /** True when this call replayed a stored idempotent result instead of writing. */
  replayed: boolean;
};

/**
 * Failure reasons a client may see. `not_found` deliberately covers "no such
 * candidate", "another tenant's candidate", and "wrong connection" with one
 * indistinguishable answer, so the action cannot be used to probe whether
 * another seller's candidate exists.
 */
export type ProductDraftFailureReason =
  | 'invalid_input'
  | 'denied'
  | 'rate_limited'
  | 'not_found'
  | 'connection_unhealthy'
  | 'supplier_unavailable'
  | 'idempotency_conflict'
  | 'version_conflict'
  | 'not_configured'
  | 'failed';

export type ProductDraftActionResult =
  | { ok: true; result: ProductDraftResult }
  | { ok: false; reason: ProductDraftFailureReason };

export type BulkProductDraftActionResult =
  | {
      ok: true;
      created: number;
      replayed: number;
      failed: Array<{
        candidateId: string;
        reason: ProductDraftFailureReason;
      }>;
    }
  | { ok: false; reason: ProductDraftFailureReason };

/** Audit action names. Stable strings — a rename breaks historical queries. */
export const PRODUCT_AUDIT_ACTIONS = {
  productCreated: 'catalog_product.created',
  productReused: 'catalog_product.reused',
  /**
   * Matches `taxonomy/product-category.ts`'s own action name, so a category
   * assignment reads identically in the audit trail whether the platform
   * remap script or draft creation applied the approved mapping.
   */
  categoryAssigned: 'product.category_assigned',
  revisionCreated: 'catalog_product_revision.created',
  revisionSaved: 'catalog_product_revision.saved',
  revisionSaveRejected: 'catalog_product_revision.save_rejected_stale',
  variantCreated: 'catalog_product_variant.created',
  offerCreated: 'catalog_product_offer.created',
  bindingCreated: 'catalog_offer_supplier_binding.created',
  draftRequestConflict: 'catalog_product_draft.idempotency_conflict',
  mediaUploaded: 'catalog_product_media.seller_uploaded',
} as const;

/** Operation name recorded on `idempotency_records.operation`. */
export const CREATE_PRODUCT_DRAFT_OPERATION = 'catalog.product-draft.create';

/** Spec §4.2 keeps a replayable window; a key is not a permanent reservation. */
export const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1000;
