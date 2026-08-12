/**
 * Every caveat and empty-state sentence the candidate detail drawer renders,
 * in one place.
 *
 * Centralised because most of these are not decoration - they are the sentence
 * that stops a number from being misread. A caveat that drifts out of step with
 * the value it qualifies is worse than no caveat at all.
 */

/**
 * The three kinds of absence, which must never look or read alike.
 *
 * `NOT_FETCHED` vs `REPORTED_ZERO` is the load-bearing distinction: a zero from
 * CJ is a fact about the product, an absent fetch is a fact about our pipeline.
 * Only 19 of 87,966 candidates have a captured snapshot, so `NOT_FETCHED` is the
 * case a reviewer will nearly always see - and if it reads as "CJ reported
 * nothing", they will conclude a product has no stock when nobody ever looked.
 */
export const ABSENT_COPY = {
  notFetchedTitle: 'Not fetched from CJ yet',
  notFetched:
    'CJ detail evidence has never been captured for this candidate. This section is empty because nothing was fetched — not because CJ reported nothing. Screening decides from the stored listing summary and makes no CJ detail, inventory, or comments call.',
  reportedZeroTitle: 'CJ reported none',
  neverQueued:
    'This candidate was discovered but has never been queued for evaluation, so there is no decision, no screening summary, and no queue state to show.',
} as const;

export const NEVER_RECORDED_COPY = {
  attestations:
    'No one has recorded a CJ/MyCJ stock inspection for this candidate. This is an honest unknown — not "in stock", and not "out of stock".',
  discoverySignals:
    'No CJ discovery signal has been observed for this candidate. It was found by the canonical partition scan rather than a trending, most-listed, or new-arrival lane.',
  pricingOverrides:
    'No pricing override has ever been recorded for this candidate.',
  auditEvents:
    'No activity has been recorded against this candidate yet. Audit events are written when it is evaluated or when someone records a stock inspection.',
  productReferences:
    'This candidate has never been drafted into a Sals3 product.',
} as const;

export const CAVEAT_COPY = {
  /** The column is reserved and always null; a `—` beside a "Score" label reads as "scored zero". */
  noScore:
    'No quality score or publish decision beyond the status above is computed for this candidate. Scoring and the compliance gate are not built.',
  estimatedMargin:
    'A rough proxy from the placeholder policy. Not a real margin, and never a pricing input.',
  listedCount:
    'How many CJ sellers list this product. Not a sales, order, or customer count.',
  rawSupplierFields:
    'Supplier hints, passed through unjudged. Neither is a verified classification, and a customs code here is not import advice.',
  workerLease:
    'Internal worker bookkeeping, shown so a stuck row can be explained. Not a seller-facing state.',
  pricingOverrideAudit:
    'Override history lives in these rows, not in Activity: pricing audit events are keyed by the override, not by the candidate.',
  externalIdLookup:
    'Look this up in your own CJ session. No supplier link is offered from here, and no credential is ever shown.',
} as const;

/** Shown when `?candidate=` names a candidate this seller cannot read - for any reason. */
export const MISSING_COPY = {
  title: 'Not in your pipeline',
  body: 'No candidate with that id belongs to your account. It may never have existed, or it may belong to another seller — this screen deliberately cannot tell you which.',
} as const;
