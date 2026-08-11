/**
 * Configuration for continuous full-catalogue discovery (ADR-010 §12,
 * ADR-013 §3/§5/§12). Values fall into three strict classes:
 *
 * 1. DOCUMENTED provider contract values, safe to fix in code (page size
 *    max 200, list cost 50 points, subscription batch max 100, points reset
 *    00:00 UTC).
 * 2. UNDOCUMENTED provider details that must stay configurable and are
 *    rollout blockers until the owner-authorized read-only CJ contract
 *    probe verifies them (the `createTimeFrom/To` timezone, the earliest
 *    meaningful catalogue timestamp).
 * 3. Sals3 operational tuning (budgets, thresholds), env-overridable with
 *    conservative defaults.
 *
 * There is intentionally NO 6,000 constant anywhere in this module: that cap
 * is documented for Product List V2 only and never applies to the legacy
 * list endpoint this scanner uses.
 */

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];

  if (raw === undefined || raw.trim() === '') return fallback;

  const parsed = Number.parseInt(raw, 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function envString(name: string, fallback: string): string {
  const raw = process.env[name];

  return raw === undefined || raw.trim() === '' ? fallback : raw.trim();
}

// --- Documented provider contract (class 1) ---------------------------------

/** Documented legacy `/product/list` per-page maximum. */
export const DISCOVERY_PAGE_SIZE = 200;

/** Documented points cost of one legacy `/product/list` request. */
export const PRODUCT_LIST_POINTS_COST = 50;

/** Documented points cost of a product detail / inventory query. */
export const PRODUCT_QUERY_POINTS_COST = 10;

/** Documented: CJ points reset daily at 00:00 UTC. */
export function nextUtcMidnight(now: Date): Date {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return next;
}

// --- Undocumented provider details (class 2 - rollout blockers) --------------

/**
 * IANA timezone used to render `createTimeFrom/To` wire values. CJ documents
 * only the format string `yyyy-MM-dd hh:mm:ss`, NOT the timezone. UTC is a
 * labelled assumption; the owner-authorized sandbox contract probe must
 * verify the real interpretation before production rollout. Because sibling
 * partitions overlap at boundaries and deduplicate by PID, a wrong timezone
 * skews partition density but cannot silently lose a product inside a
 * cycle's covered range - only the range edges depend on this value being
 * right, which is exactly what the probe must confirm.
 */
export const CJ_CREATE_TIME_TIMEZONE = envString(
  'CJ_CREATE_TIME_TIMEZONE',
  'UTC',
);

/**
 * Configurable initial discovery epoch (ISO 8601). Products created before
 * this instant are still covered - by each category's open-start sentinel
 * partition - so this value bounds where adaptive time-bisection starts,
 * not what discovery can see. The default is a deliberate, labelled
 * assumption, NOT a claimed provider earliest timestamp.
 */
export const DISCOVERY_EPOCH_ISO = envString(
  'CJ_DISCOVERY_EPOCH',
  '2016-01-01T00:00:00Z',
);

export function discoveryEpochMs(): number {
  const parsed = Date.parse(DISCOVERY_EPOCH_ISO);

  if (Number.isNaN(parsed)) {
    throw new Error('CJ_DISCOVERY_EPOCH is not a valid ISO 8601 timestamp.');
  }

  return parsed;
}

// --- Sals3 operational tuning (class 3) --------------------------------------

/** Minimum provider-supported time interval: the wire format resolves to one second. */
export const MIN_TIME_INTERVAL_MS = 1_000;

/** Price precision observed in normalized provider values: one USD cent. */
export const MIN_PRICE_INTERVAL_CENTS = 1;

/** First price split point when a partition has no price bounds yet (USD cents). */
export const INITIAL_PRICE_SPLIT_CENTS = envInt(
  'CATALOG_DISCOVERY_INITIAL_PRICE_SPLIT_CENTS',
  1_000,
);

/** Supplier list-page requests one partition message may spend before re-enqueueing itself. */
export const RECONCILE_PAGES_PER_INVOCATION = envInt(
  'CATALOG_DISCOVERY_RECONCILE_PAGES_PER_INVOCATION',
  5,
);

/** Bounded category-root seeding batch per DISCOVERY_CYCLE_START invocation. */
export const SEED_BATCH_SIZE = envInt('CATALOG_DISCOVERY_SEED_BATCH_SIZE', 100);

/** Partition lease duration; a crashed worker's lease expires and the work is re-claimed. */
export const PARTITION_LEASE_MS = envInt(
  'CATALOG_DISCOVERY_PARTITION_LEASE_MS',
  5 * 60 * 1000,
);

/** Bounded attempts before a partition surfaces as FAILED (visible, never silent). */
export const MAX_PARTITION_ATTEMPTS = envInt(
  'CATALOG_DISCOVERY_MAX_PARTITION_ATTEMPTS',
  5,
);

/** Bounded complete enumeration attempts before an atomic bucket is PROVIDER_COVERAGE_UNRESOLVED. */
export const MAX_RECONCILE_ATTEMPTS = envInt(
  'CATALOG_DISCOVERY_MAX_RECONCILE_ATTEMPTS',
  4,
);

/**
 * Planning assumption for the daily points allowance until real `pointsInfo`
 * is observed (documented base allowance).
 */
export const POINTS_DAILY_PLANNING_TOTAL = envInt(
  'CJ_POINTS_DAILY_PLANNING_TOTAL',
  50_000,
);

/**
 * Background discovery/evaluation may spend at most this share of currently
 * known available points; the remainder is reserved for selected/live/order-
 * critical work (ADR-013 §5).
 */
export const BACKGROUND_POINTS_MAX_PERCENT = envInt(
  'CJ_BACKGROUND_POINTS_MAX_PERCENT',
  80,
);

/**
 * Default minimum spacing between supplier requests per connection: one
 * request per second (the documented lowest account tier) until the actual
 * tier is verified.
 */
export const REQUEST_MIN_INTERVAL_MS = envInt(
  'CJ_REQUEST_MIN_INTERVAL_MS',
  1_000,
);

/** Delay before a budget-blocked unit of work retries, aligned with per-minute replenishment. */
export const BUDGET_RETRY_DELAY_SECONDS = envInt(
  'CATALOG_DISCOVERY_BUDGET_RETRY_DELAY_SECONDS',
  15 * 60,
);

/** Queue delay between a completed cycle and the next cycle's start. */
export const NEXT_CYCLE_DELAY_SECONDS = envInt(
  'CATALOG_DISCOVERY_NEXT_CYCLE_DELAY_SECONDS',
  6 * 60 * 60,
);

/** Sweep cadence: the active cycle re-enqueues a self-healing sweep at this delay. */
export const CYCLE_SWEEP_DELAY_SECONDS = envInt(
  'CATALOG_DISCOVERY_SWEEP_DELAY_SECONDS',
  30 * 60,
);

/** Freshness sweep batch bound and self-chaining delay. Tier durations live in `rules/policy.ts#nextRefreshAtFor`. */
export const FRESHNESS_SWEEP_BATCH = envInt(
  'CATALOG_FRESHNESS_SWEEP_BATCH',
  50,
);
export const FRESHNESS_SWEEP_DELAY_SECONDS = envInt(
  'CATALOG_FRESHNESS_SWEEP_DELAY_SECONDS',
  60 * 60,
);

/**
 * Development-pilot evidence allowance: the maximum number of candidates
 * that may ever complete a PAID CJ evidence fetch. A TOTAL, not a daily
 * rate - it never resets, so reaching it stops paid evaluation until the
 * owner raises it deliberately.
 *
 * This is a backstop, not the primary control. The primary control is data:
 * only candidates whose own `intended_market_codes` was explicitly
 * backfilled to an enabled destination survive `checkValidMarket`, and that
 * gate is atomic, race-free, and honored by every execution path. This
 * counter exists so a mistake in that data can still not run away.
 *
 * `CATALOG_PILOT_BASELINE_COUNT` anchors the count to whatever had already
 * completed a paid fetch before the pilot began; without it, pre-existing
 * rows silently consume the allowance and a rollback-then-retry starts with
 * nothing left.
 *
 * NOTE: `envInt` rejects 0 and negatives and falls back to the default, so
 * the cap CANNOT be disabled by setting it to 0. Set it to 1 to freeze paid
 * evaluation, or raise it to continue.
 */
export const PILOT_EVIDENCE_CAP = envInt('CATALOG_PILOT_EVIDENCE_CAP', 2_000);
export const PILOT_BASELINE_COUNT = envInt('CATALOG_PILOT_BASELINE_COUNT', 0);

/**
 * Neon development-pilot storage guards. The configured allowance defaults
 * to Neon Free's 0.5 GB; warn at ~70%, pause new broad discovery at ~80%.
 * Accumulated product/evidence records are never deleted automatically.
 */
export const STORAGE_ALLOWANCE_BYTES = envInt(
  'NEON_STORAGE_ALLOWANCE_BYTES',
  512 * 1024 * 1024,
);
export const STORAGE_WARN_PERCENT = envInt('NEON_STORAGE_WARN_PERCENT', 70);
export const STORAGE_PAUSE_PERCENT = envInt('NEON_STORAGE_PAUSE_PERCENT', 80);

/** Queue transport topic; consumers are private Vercel Queue functions. */
export const QUEUE_TOPIC = envString(
  'CATALOG_QUEUE_TOPIC',
  'catalog-discovery',
);

/** Max at-least-once deliveries before a message is parked as a visible failure. */
export const MAX_QUEUE_DELIVERIES = envInt('CATALOG_QUEUE_MAX_DELIVERIES', 8);

/** Outbox dispatch batch bound per drain. */
export const OUTBOX_DISPATCH_BATCH = envInt(
  'CATALOG_OUTBOX_DISPATCH_BATCH',
  25,
);

/** Outbox lease duration during a dispatch attempt. */
export const OUTBOX_LEASE_MS = envInt('CATALOG_OUTBOX_LEASE_MS', 60 * 1000);

/** Bounded attempts before an outbox row is marked FAILED (visible, recoverable). */
export const MAX_OUTBOX_ATTEMPTS = envInt('CATALOG_OUTBOX_MAX_ATTEMPTS', 10);
