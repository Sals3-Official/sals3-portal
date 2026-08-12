import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { supplierCandidates, stockReviewStateEnum } from './catalog';
import { supplierConnections } from './supplier-connections';

/**
 * Lean All Supplier Products intake (ADR-013 §1a, owner decision 2026-08-12).
 *
 * The raw catalogue is a discovery and local-screening surface. It never
 * calls a paid CJ evidence endpoint to learn stock, and it never claims to
 * know stock it has not looked at. Everything here exists to make that
 * honest and durable across Vercel restarts and concurrent queue consumers:
 *
 * - a truthful per-candidate manual stock-review state, separate from the
 *   candidate's lifecycle decision, plus its append-only attestation history;
 * - CJ discovery-signal observations (trending / high listed / new arrival),
 *   which are supplier ranking evidence and never Sals3 business truth;
 * - the one-time existing-backlog drain gate every discovery lane consults
 *   before its first broad `product/list` request;
 * - the durable new-unique-PID capacity ledger that enforces the owner's
 *   rolling 600-PID intake waves exactly, without overshoot, across workers;
 * - curated-lane cursors, deliberately OUTSIDE the coverage cycle/partition
 *   machinery so a curated subset can never mark catalogue coverage complete.
 */

// --- Manual stock review ------------------------------------------------------

/**
 * Append-only history of manual stock attestations. The current state also
 * lives denormalized on `supplier_candidates` (so the table read stays one
 * query), but this table is the record: corrections append, never rewrite,
 * matching `audit_events`' own rule.
 *
 * `note` is bounded and redacted at the write boundary - it must never carry
 * supplier credentials, tokens, or a deep link that leaks them.
 */
export const candidateStockAttestations = pgTable(
  'candidate_stock_attestations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    candidateId: uuid('candidate_id')
      .notNull()
      .references(() => supplierCandidates.id, { onDelete: 'cascade' }),
    state: stockReviewStateEnum('state').notNull(),
    /** Portal identity that performed the inspection - never a system actor. */
    actorId: text('actor_id').notNull(),
    /** When the human actually looked at CJ/MyCJ, which can precede recording. */
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    observedQuantity: integer('observed_quantity'),
    /** Free-text origin/warehouse label as the person read it. Never parsed as truth. */
    observedOrigin: text('observed_origin'),
    note: text('note'),
    /** The candidate's stock-review version this attestation superseded (CAS proof). */
    supersededVersion: integer('superseded_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('candidate_stock_attestations_candidate_idx').on(
      table.candidateId,
      table.createdAt,
    ),
    check(
      'candidate_stock_attestations_quantity_non_negative',
      sql`${table.observedQuantity} IS NULL OR ${table.observedQuantity} >= 0`,
    ),
  ],
);

// --- CJ discovery signals -------------------------------------------------------

/**
 * Which curated CJ lane observed this product. These are CJ supplier-platform
 * ranking signals, NOT Sals3 eligibility, stock, or profitability claims:
 * `CJ_HIGH_LISTED` in particular derives from `listedNum`, which CJ documents
 * as the number of platform listings - never units sold.
 */
export const discoverySignalEnum = pgEnum('discovery_signal', [
  'CJ_TRENDING',
  'CJ_HIGH_LISTED',
  'CJ_NEW_ARRIVAL',
]);

/**
 * One row per (candidate, signal). The unique key IS the deduplication, so
 * an at-least-once redelivery or two concurrent curated workers can only ever
 * create one logical observation; a repeat sighting refreshes
 * `lastObservedAt`/`observationCount` instead of inserting a second row.
 */
export const candidateDiscoverySignals = pgTable(
  'candidate_discovery_signals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    candidateId: uuid('candidate_id')
      .notNull()
      .references(() => supplierCandidates.id, { onDelete: 'cascade' }),
    signal: discoverySignalEnum('signal').notNull(),
    /** Curated lane key that produced the observation (see `curated-lanes.ts`). */
    sourceLane: text('source_lane').notNull(),
    /** Redacted description of the provider query - filters only, never a token. */
    sourceQuery: text('source_query'),
    /** Raw displayed `listedNum` at observation time, when the feed carried one. */
    observedListedNum: integer('observed_listed_num'),
    firstObservedAt: timestamp('first_observed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastObservedAt: timestamp('last_observed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    observationCount: integer('observation_count').notNull().default(1),
  },
  (table) => [
    uniqueIndex('candidate_discovery_signals_candidate_signal_key').on(
      table.candidateId,
      table.signal,
    ),
    index('candidate_discovery_signals_signal_idx').on(table.signal),
  ],
);

// --- One-time existing-backlog drain gate ----------------------------------------

/**
 * `PENDING_ACTIVATION` never persists - the row is created already activated,
 * with its immutable `activationAt` cutoff. It exists as a value only so an
 * unexpected NULL cutoff can be read as a state rather than guessed at.
 *
 * `DRAINING`: actionable pre-cutoff backlog remains; every discovery lane
 *   refuses to make a new broad `product/list` request.
 * `DRAIN_COMPLETE`: one-time completion, recorded once and never re-armed.
 *   Post-cutoff candidates can never move a connection back to `DRAINING` -
 *   the cutoff is the whole point of the design.
 */
export const backlogGateStateEnum = pgEnum('discovery_backlog_gate_state', [
  'PENDING_ACTIVATION',
  'DRAINING',
  'DRAIN_COMPLETE',
]);

export const discoveryBacklogGates = pgTable(
  'discovery_backlog_gates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    supplierConnectionId: uuid('supplier_connection_id')
      .notNull()
      .references(() => supplierConnections.id, { onDelete: 'restrict' }),
    /**
     * Immutable activation cutoff. "Backlog" means only Candidate Pipeline
     * work that existed at this instant. Never mutated after insert: that is
     * what stops a future product from re-arming a completed one-time gate.
     */
    activationAt: timestamp('activation_at', { withTimezone: true }).notNull(),
    /** Actionable backlog observed at activation - reporting only, never a gate input. */
    baselineBacklogCount: integer('baseline_backlog_count')
      .notNull()
      .default(0),
    state: backlogGateStateEnum('state').notNull().default('DRAINING'),
    lastObservedBacklog: integer('last_observed_backlog'),
    lastEvaluatedAt: timestamp('last_evaluated_at', { withTimezone: true }),
    drainCompletedAt: timestamp('drain_completed_at', { withTimezone: true }),
    /** Guards concurrent completion writes (compare-and-set). */
    stateVersion: integer('state_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('discovery_backlog_gates_connection_key').on(
      table.supplierConnectionId,
    ),
  ],
);

// --- New-unique-PID intake ceiling -------------------------------------------------

/**
 * Durable capacity ledger for the owner's rolling new-PID intake waves
 * (default 600 per supplier connection, `CATALOG_NEW_DISCOVERY_WAVE_SIZE`).
 *
 * A process-local counter would be wrong twice over: Vercel restarts lose it,
 * and concurrent queue consumers would each keep their own. Capacity is
 * therefore consumed by a conditional `UPDATE ... WHERE admitted_count <
 * limit_value` in the SAME transaction that inserts the candidate row, so the
 * current wave can never be overshot no matter how work is redelivered.
 *
 * `limitValue` is the current wave edge, so the status endpoint reports what
 * the ledger is actually enforcing rather than what the current process
 * happens to have in its environment. Once active pipeline work drains, the
 * gate advances this edge to `admittedCount + waveSize`.
 */
export const discoveryPidCapacities = pgTable(
  'discovery_pid_capacities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    supplierConnectionId: uuid('supplier_connection_id')
      .notNull()
      .references(() => supplierConnections.id, { onDelete: 'restrict' }),
    limitValue: integer('limit_value').notNull(),
    /** Newly admitted unique supplier PIDs. Monotonic; a re-observed PID never increments it. */
    admittedCount: integer('admitted_count').notNull().default(0),
    lastAdmittedAt: timestamp('last_admitted_at', { withTimezone: true }),
    capReachedAt: timestamp('cap_reached_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('discovery_pid_capacities_connection_key').on(
      table.supplierConnectionId,
    ),
    check(
      'discovery_pid_capacities_within_limit',
      sql`${table.admittedCount} <= ${table.limitValue}`,
    ),
    check(
      'discovery_pid_capacities_non_negative',
      sql`${table.admittedCount} >= 0 AND ${table.limitValue} >= 0`,
    ),
  ],
);

// --- Curated CJ discovery lanes ------------------------------------------------------

/**
 * Curated lanes are intentionally a SUBSET of the catalogue. They live in
 * their own table with their own cursor, entirely outside
 * `discovery_cycles`/`discovery_partitions`, so a curated run structurally
 * cannot mark a partition COVERED, finish a cycle, or mask
 * `PROVIDER_COVERAGE_UNRESOLVED`. They use only legacy
 * `GET /api2.0/v1/product/list`.
 */
export const curatedLaneEnum = pgEnum('discovery_curated_lane', [
  'CJ_TRENDING',
  'CJ_MOST_LISTED',
  'CJ_NEW_ARRIVALS',
]);

export const curatedLaneStateEnum = pgEnum('discovery_curated_lane_state', [
  'IDLE',
  'RUNNING',
  'PAUSED',
  'EXHAUSTED',
]);

export const discoveryCuratedLanes = pgTable(
  'discovery_curated_lanes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    supplierConnectionId: uuid('supplier_connection_id')
      .notNull()
      .references(() => supplierConnections.id, { onDelete: 'restrict' }),
    lane: curatedLaneEnum('lane').notNull(),
    state: curatedLaneStateEnum('state').notNull().default('IDLE'),
    /** Resumable page cursor. A pause never advances it. */
    nextPage: integer('next_page').notNull().default(1),
    pagesFetched: integer('pages_fetched').notNull().default(0),
    /** New-arrivals window bounds (epoch ms), fixed when the run starts. */
    windowFromMs: bigint('window_from_ms', { mode: 'number' }),
    windowToMs: bigint('window_to_ms', { mode: 'number' }),
    newPidsAdmitted: integer('new_pids_admitted').notNull().default(0),
    signalsRecorded: integer('signals_recorded').notNull().default(0),
    /** Exactly why the lane is paused - surfaced verbatim in the status endpoint. */
    lastPauseReason: text('last_pause_reason'),
    lastErrorCode: text('last_error_code'),
    attempts: integer('attempts').notNull().default(0),
    leaseToken: text('lease_token'),
    leasedUntil: timestamp('leased_until', { withTimezone: true }),
    stateVersion: integer('state_version').notNull().default(1),
    /**
     * The `discovery_pid_capacities.limit_value` in force when this lane last
     * reported it could contribute nothing more — provider pages ran out, or
     * `CURATED_MAX_PAGES` was reached.
     *
     * Deliberately scoped to a wave rather than a permanent flag: a lane
     * exhausted in one wave must be retried in the next, because new products
     * appear between waves and `advanceCuratedLane` already resets the page
     * cursor when a run finishes. A lane is eligible for the current wave when
     * this is null or differs from the current wave edge.
     *
     * This is what makes strict intake priority possible: the canonical
     * partition scanner yields while any lane is eligible, and a lower-priority
     * lane waits for the ones above it.
     */
    exhaustedAtWaveLimit: integer('exhausted_at_wave_limit'),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('discovery_curated_lanes_connection_lane_key').on(
      table.supplierConnectionId,
      table.lane,
    ),
    check(
      'discovery_curated_lanes_next_page_positive',
      sql`${table.nextPage} >= 1`,
    ),
  ],
);

export type CandidateStockAttestationRow =
  typeof candidateStockAttestations.$inferSelect;
export type CandidateDiscoverySignalRow =
  typeof candidateDiscoverySignals.$inferSelect;
export type DiscoveryBacklogGateRow = typeof discoveryBacklogGates.$inferSelect;
export type DiscoveryPidCapacityRow =
  typeof discoveryPidCapacities.$inferSelect;
export type DiscoveryCuratedLaneRow = typeof discoveryCuratedLanes.$inferSelect;
export type StockReviewState = (typeof stockReviewStateEnum.enumValues)[number];
export type DiscoverySignal = (typeof discoverySignalEnum.enumValues)[number];
export type CuratedLane = (typeof curatedLaneEnum.enumValues)[number];
