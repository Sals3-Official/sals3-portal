import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Catalog persistence for the CJ candidate handoff.
 *
 * Scope is deliberately narrow: only the **Shortlist** step from
 * `cj-candidate-to-sals3-product-draft-implementation-spec.md` section 8.1 is
 * persisted here. Full preflight (section 8.3) needs a live CJ
 * detail/variant/inventory/media enrichment fetch that does not exist yet, so
 * no preflight decision, score, Product, Variant, Offer, or MediaAsset table
 * is modelled. Modelling them before the flow that fills them would be schema
 * for its own sake.
 *
 * Names are snake_case so no statement ever needs quoted identifiers.
 * `uuid` primary keys use Postgres' built-in `gen_random_uuid()` (core since
 * PG13) rather than an id library — one less dependency to audit.
 */

/** Spec section 5.1: CJ is the only integrated supplier today. */
export const supplierEnum = pgEnum('supplier', ['CJ_DROPSHIPPING']);

/**
 * Spec section 8.1: "The first persisted step is Shortlist. It creates
 * SupplierCandidate, not Product, Variant, Offer, MediaAsset, or public
 * search data."
 *
 * Every row created today is `SHORTLISTED`. `PREFLIGHT_PENDING` is reserved
 * for when a preflight job is genuinely queued — it is NOT one of the spec's
 * five preflight decisions (PASS / PASS_WITH_ATTENTION / REVIEW / HOLD /
 * BLOCKED), none of which anything can produce yet.
 */
export const shortlistStateEnum = pgEnum('shortlist_state', [
  'SHORTLISTED',
  'PREFLIGHT_PENDING',
]);

/**
 * Spec section 5.3 (phase-1 subset). The unique key on
 * `(supplier, external_product_id)` enforces spec section 4.2 in the
 * database, not just in application code: "Re-importing the same CJ `pid`
 * returns the existing Sals3 product or active draft. It does not create a
 * duplicate."
 */
export const supplierCandidates = pgTable(
  'supplier_candidates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    supplier: supplierEnum('supplier').notNull(),
    externalProductId: text('external_product_id').notNull(),
    intendedSellerId: text('intended_seller_id').notNull(),
    intendedMarketCodes: text('intended_market_codes').array().notNull(),
    shortlistState: shortlistStateEnum('shortlist_state')
      .notNull()
      .default('SHORTLISTED'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: text('created_by').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('supplier_candidates_supplier_external_product_id_key').on(
      table.supplier,
      table.externalProductId,
    ),
    index('supplier_candidates_intended_seller_id_idx').on(
      table.intendedSellerId,
    ),
  ],
);

/**
 * Spec section 4.2/4.3: "Every import request requires an `Idempotency-Key`.
 * The same key and same payload return the original result. The same key with
 * a different payload returns `409 IDEMPOTENCY_CONFLICT`." Records store
 * actor, operation, request hash, result reference, and expiry policy.
 *
 * `request_hash` stores a SHA-256 of the canonical payload, never the payload
 * itself — nothing sensitive is retained to compare two requests.
 */
export const idempotencyRecords = pgTable(
  'idempotency_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    actorId: text('actor_id').notNull(),
    operation: text('operation').notNull(),
    requestHash: text('request_hash').notNull(),
    resultReference: jsonb('result_reference').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('idempotency_records_key_key').on(table.key),
    // Supports cheap expiry sweeps without a full scan.
    index('idempotency_records_expires_at_idx').on(table.expiresAt),
  ],
);

/**
 * Spec section 5.3: "`AuditEvent` is append-only. Corrections create a new
 * event. They do not rewrite history." No application code exposes an update
 * or delete path for this table.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: text('actor_id').notNull(),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('audit_events_entity_type_entity_id_idx').on(
      table.entityType,
      table.entityId,
    ),
  ],
);

export type SupplierCandidateRow = typeof supplierCandidates.$inferSelect;
export type NewSupplierCandidateRow = typeof supplierCandidates.$inferInsert;
export type IdempotencyRecordRow = typeof idempotencyRecords.$inferSelect;
export type AuditEventRow = typeof auditEvents.$inferSelect;
