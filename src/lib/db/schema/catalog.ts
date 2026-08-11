import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { supplierConnections } from './supplier-connections';

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
    /**
     * Legacy display field, superseded by `supplierConnectionId` (below) as
     * the source of truth for tenant scoping — every real query resolves
     * the owning seller by joining through the connection, per ADR-006/008.
     * Kept only because no migration removes it yet.
     */
    intendedSellerId: text('intended_seller_id').notNull(),
    /**
     * ADR-008: which seller's own supplier connection this candidate came
     * from — the source of truth for uniqueness and tenant scoping.
     * `NOT NULL` as of Migration B (0004), after
     * `scripts/bootstrap-sals3-official-cj.mts` backfilled every
     * pre-existing row and verified zero remaining nulls.
     */
    supplierConnectionId: uuid('supplier_connection_id')
      .notNull()
      .references(() => supplierConnections.id, { onDelete: 'restrict' }),
    intendedMarketCodes: text('intended_market_codes').array().notNull(),
    shortlistState: shortlistStateEnum('shortlist_state')
      .notNull()
      .default('SHORTLISTED'),
    providerLastSeenAt: timestamp('provider_last_seen_at', {
      withTimezone: true,
    }),
    providerLastVerifiedAt: timestamp('provider_last_verified_at', {
      withTimezone: true,
    }),
    providerRemovalSuspectedAt: timestamp('provider_removal_suspected_at', {
      withTimezone: true,
    }),
    providerRemovalConfirmedAt: timestamp('provider_removal_confirmed_at', {
      withTimezone: true,
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: text('created_by').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Connection-scoped as of Migration B (0004) - replaces the old global
    // (supplier, external_product_id) uniqueness. Two different sellers'
    // connections can each shortlist the same CJ pid independently; only
    // one seller re-shortlisting the same pid through the same connection
    // is a duplicate.
    uniqueIndex('supplier_candidates_connection_external_product_key').on(
      table.supplierConnectionId,
      table.externalProductId,
    ),
    index('supplier_candidates_connection_state_idx').on(
      table.supplierConnectionId,
      table.shortlistState,
    ),
    index('supplier_candidates_provider_freshness_idx').on(
      table.providerLastSeenAt,
      table.providerLastVerifiedAt,
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
 * Spec section 5.2 `SupplierSnapshot`, phase-1 subset.
 *
 * Stores the normalised CJ evidence captured at shortlist time — never the raw
 * supplier payload, so no unredacted third-party blob is retained. `checksum`
 * is a SHA-256 of the normalised evidence, which is what lets a later fetch
 * tell "unchanged" from "changed" without diffing the whole document.
 *
 * One row per candidate: a re-check replaces it, because stale evidence has no
 * value and keeping every version would grow without bound for no current
 * consumer. Version history becomes worth adding when preflight decisions
 * start citing a specific snapshot.
 */
export const supplierSnapshots = pgTable(
  'supplier_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    candidateId: uuid('candidate_id')
      .notNull()
      .references(() => supplierCandidates.id, { onDelete: 'cascade' }),
    schemaVersion: text('schema_version').notNull(),
    checksum: text('checksum').notNull(),
    evidence: jsonb('evidence').notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('supplier_snapshots_candidate_id_key').on(table.candidateId),
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

/**
 * Automated evaluation state for one candidate (spec sections 8.4-8.6, 14 -
 * the "judgement" the spec explicitly left unbuilt as of section 26).
 *
 * `QUEUED`/`EVALUATING` are job-queue states; the rest are decisions. This is
 * deliberately a separate table from `supplierCandidates` rather than new
 * columns there: lease/retry fields (`leasedBy`, `attemptCount`, ...) are job
 * mechanics, not candidate identity, and keeping them apart means a candidate
 * row's meaning never changes shape depending on where it is in the pipeline.
 *
 * IMPORTANT: as of this migration, several fields are labelled placeholders,
 * not approved business/legal policy - see `rules/policy.ts`. `policyVersion`
 * exists precisely so those can be swapped for a real ADR-002/ADR-003 pilot
 * rule pack later without a schema change.
 */
export const evaluationStatusEnum = pgEnum('evaluation_status', [
  'QUEUED',
  'EVALUATING',
  'PASS',
  'PASS_WITH_ATTENTION',
  'TEMPORARILY_INELIGIBLE',
  'BLOCKED',
  'EVALUATION_FAILED',
]);

/**
 * Why a row is currently `QUEUED` (or was, the last time it left `QUEUED`) -
 * distinct from `reasonCodes`, which explain a *decision*, not an admission.
 * `EVIDENCE_EXPIRED`/`POLICY_VERSION_CHANGED` are reserved for the freshness/
 * policy-version re-evaluation slices approved in ADR-010 §12 but not yet
 * implemented here - same forward-declared-but-unused pattern as
 * `shortlistStateEnum`'s `PREFLIGHT_PENDING` above. `requeueForManualRecheck`
 * (admin/debug "Recheck now") intentionally leaves this null: it is not one
 * of the six approved reasons, and the actor/action fields on its own
 * `AuditEvent` already distinguish "a person did this" from "the pipeline
 * did this on its own."
 */
export const admissionReasonEnum = pgEnum('admission_reason', [
  'NEW_PRODUCT',
  'MATERIAL_SOURCE_CHANGE',
  'EVIDENCE_EXPIRED',
  'POLICY_VERSION_CHANGED',
  'RETRY_DUE',
  'CONNECTION_RESTORED',
]);

export const candidateEvaluations = pgTable(
  'candidate_evaluations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    candidateId: uuid('candidate_id')
      .notNull()
      .references(() => supplierCandidates.id, { onDelete: 'cascade' }),
    status: evaluationStatusEnum('status').notNull().default('QUEUED'),
    /** See `admissionReasonEnum` above. Null for a row that was never (re)queued through one of the six approved paths. */
    admissionReason: admissionReasonEnum('admission_reason'),
    /** Validated against a Zod enum at the write boundary; see rules/contracts.ts. */
    reasonCodes: text('reason_codes').array().notNull().default([]),
    /** Short derived facts for display - never the raw CJ payload. */
    evidenceSummary: jsonb('evidence_summary'),
    sourceSnapshotChecksum: text('source_snapshot_checksum'),
    policyVersion: text('policy_version').notNull(),
    /** Reserved for real weighted scoring. No code path writes this yet. */
    score: integer('score'),
    lastKnownPriceUsdCents: integer('last_known_price_usd_cents'),
    /** Cheap hash of feed-level fields; detects "changed" without a CJ evidence call. */
    lastSeenFingerprint: text('last_seen_fingerprint').notNull(),
    /**
     * Small denormalized copy of the CJ `/product/list` feed row (category,
     * price, listed count, name) captured at ingestion time. Lets the
     * screening stage reject a candidate BEFORE spending CJ evidence-fetch
     * points, without a second network call.
     */
    feedSnapshot: jsonb('feed_snapshot').notNull(),
    leasedBy: text('leased_by'),
    leasedUntil: timestamp('leased_until', { withTimezone: true }),
    attemptCount: integer('attempt_count').notNull().default(0),
    lastErrorCode: text('last_error_code'),
    nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
    /**
     * Freshness deadline (ADR-010 §12.2): when this decision's evidence must
     * be reconciled again. Qualified-but-unselected products refresh within
     * 72 hours, other operational nonterminal products within 30 days;
     * permanent policy blocks stay `null` and re-evaluate only on a supplier
     * data or policy/evidence version change. The freshness sweep requeues
     * rows whose deadline passed with admission reason `EVIDENCE_EXPIRED`.
     */
    nextRefreshAt: timestamp('next_refresh_at', { withTimezone: true }),
    evaluatedAt: timestamp('evaluated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('candidate_evaluations_candidate_id_key').on(table.candidateId),
    index('candidate_evaluations_status_idx').on(table.status),
    index('candidate_evaluations_next_retry_at_idx').on(table.nextRetryAt),
    index('candidate_evaluations_next_refresh_at_idx').on(table.nextRefreshAt),
  ],
);

export type SupplierCandidateRow = typeof supplierCandidates.$inferSelect;
export type NewSupplierCandidateRow = typeof supplierCandidates.$inferInsert;
export type IdempotencyRecordRow = typeof idempotencyRecords.$inferSelect;
export type SupplierSnapshotRow = typeof supplierSnapshots.$inferSelect;
export type AuditEventRow = typeof auditEvents.$inferSelect;
export type CandidateEvaluationRow = typeof candidateEvaluations.$inferSelect;
export type NewCandidateEvaluationRow =
  typeof candidateEvaluations.$inferInsert;
