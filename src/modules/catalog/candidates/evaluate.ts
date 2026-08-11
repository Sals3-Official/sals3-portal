import getDb from '@/lib/db/client';
import type { CandidateEvaluationRow } from '@/lib/db/schema';
import resolveBuyerDestinationCountryPolicy from '@/lib/country-policy/buyer-destination-country';
import {
  findConnectionById,
  isWorkableConnectionStatus,
} from '@/modules/suppliers/repository';
import { CONNECTION_PAUSE_ERROR_CODES } from './connection-pause';
import { decide } from './rules/decide';
import { feedSnapshotSchema } from './rules/contracts';
import { composeEvaluationPolicyVersion, POLICY_VERSION } from './rules/policy';
import { runScreening } from './rules/screening';
import {
  appendAuditEvent,
  findCandidateById,
  recordEvaluationFailure,
  recordScreeningDecision,
} from './repository';

/**
 * Evaluates one leased candidate using LOCAL Sals3 screening only.
 *
 * ADR-013 §1a (owner decision 2026-08-12) replaced the previous behavior,
 * which fetched CJ `/product/query`, `/product/stock/getInventoryByPid`, and
 * `/product/productComments` for every admitted candidate and then requeued
 * periodic refreshes. Raw All Supplier Products intake is now cheap and
 * honest: it decides from the `/product/list` summary already persisted at
 * ingestion, and says plainly that it has not checked stock.
 *
 * What this function must NOT do, and no longer does:
 *
 * - call product detail, inventory, comments, freight, or any other paid
 *   supplier-evidence endpoint;
 * - call Gemini or any other AI service (it never did, and must not start);
 * - write `evidence_summary`, which would imply supplier evidence that was
 *   never obtained;
 * - touch a candidate's manual stock-review state. `STOCK_NOT_CHECKED` is an
 *   honest unknown and only a person recording a CJ/MyCJ inspection changes
 *   it.
 *
 * Historical `supplier_snapshots` rows and every `audit_events` record from
 * the previous evidence-based implementation are left untouched and remain
 * readable. They are history, not current stock.
 *
 * A screening-only decision distinguishes source screening from stock
 * confirmation: `PASS` here means "nothing in the supplier summary
 * disqualifies this product", never "in stock" and never "ready to publish".
 */
export type EvaluateCandidateOptions = {
  /**
   * Retained so the queue handler's call site and the break-glass tick keep
   * one signature. Local screening performs no HTTP request, so nothing in
   * this module reads it; it is not removed because doing so would churn
   * every caller for no behavioral gain.
   */
  fetchImpl?: typeof fetch;
};

export default async function evaluateCandidate(
  row: CandidateEvaluationRow,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- see EvaluateCandidateOptions.
  options: EvaluateCandidateOptions = {},
): Promise<void> {
  const candidate = await findCandidateById(getDb(), row.candidateId);

  if (candidate === null) {
    // The candidate row is gone (should not happen - cascade delete would
    // remove this evaluation row too). Nothing safe to do but stop.
    return;
  }

  const feedSnapshot = feedSnapshotSchema.parse(row.feedSnapshot);

  // Resolved exactly once for this evaluation: the market rule, the stored
  // policy identity, and the audit payload all read this same snapshot, so
  // one evaluation can never observe two different buyer-destination policy
  // versions.
  const buyerDestinationPolicy = resolveBuyerDestinationCountryPolicy();
  const evaluationPolicyVersion = composeEvaluationPolicyVersion(
    POLICY_VERSION,
    buyerDestinationPolicy.policyVersion,
  );
  const marketAuditFields = {
    catalogPolicyVersion: POLICY_VERSION,
    buyerDestinationPolicyVersion: buyerDestinationPolicy.policyVersion,
    buyerDestinationPolicySource: buyerDestinationPolicy.source,
    buyerDestinationPolicyEffective: buyerDestinationPolicy.effective,
    buyerDestinationEnabledCountryCodes: buyerDestinationPolicy.countryCodes,
    candidateIntendedDestinationCodes: candidate.intendedMarketCodes,
  };

  if (candidate.supplierConnectionId === null) {
    // Should not happen after the bootstrap backfill - a candidate with no
    // connection has no owning seller. Fails safely rather than crashing.
    await getDb().transaction(async (tx) => {
      await recordEvaluationFailure(tx, {
        candidateId: row.candidateId,
        attemptCount: row.attemptCount + 1,
        lastErrorCode: 'no_supplier_connection',
        nextRetryAt: null,
      });
    });
    return;
  }

  const connection = await findConnectionById(
    getDb(),
    candidate.supplierConnectionId,
  );

  if (connection === null) {
    // A dangling supplierConnectionId should not happen - the FK is
    // `onDelete: 'restrict'` - but if it ever does, this is a genuine data
    // anomaly, not a seller-caused pause, so it still burns a technical
    // attempt like any other unexpected failure.
    await getDb().transaction(async (tx) => {
      await recordEvaluationFailure(tx, {
        candidateId: row.candidateId,
        attemptCount: row.attemptCount + 1,
        lastErrorCode: 'connection_unavailable',
        nextRetryAt: null,
      });
    });
    return;
  }

  if (!isWorkableConnectionStatus(connection.status)) {
    // ADR-007: an intentional disconnect is an expected pause, never a
    // technical failure of this product. Screening spends no supplier call,
    // but a seller who disconnected has asked Sals3 to stop working their
    // catalogue, and that intention is honored here too. Recovery stays
    // event-driven via `requeueConnectionPausedEvaluations`.
    const lastErrorCode = CONNECTION_PAUSE_ERROR_CODES[connection.status];

    await getDb().transaction(async (tx) => {
      await recordEvaluationFailure(tx, {
        candidateId: row.candidateId,
        attemptCount: row.attemptCount,
        lastErrorCode,
        nextRetryAt: null,
      });
      await appendAuditEvent(tx, {
        actorId: 'system:catalog-evaluator',
        action: 'CANDIDATE_EVALUATION_PAUSED_CONNECTION_UNAVAILABLE',
        entityType: 'supplier_candidate',
        entityId: row.candidateId,
        payload: { connectionStatus: connection.status, lastErrorCode },
      });
    });
    return;
  }

  const screeningFindings = runScreening(feedSnapshot, {
    buyerDestinationPolicy,
    candidateDestinationCodes: candidate.intendedMarketCodes,
  });
  const decision = decide(screeningFindings);

  await getDb().transaction(async (tx) => {
    await recordScreeningDecision(tx, {
      candidateId: row.candidateId,
      decision,
      policyVersion: evaluationPolicyVersion,
    });
    await appendAuditEvent(tx, {
      actorId: 'system:catalog-evaluator',
      action: 'CANDIDATE_SCREENING_DECIDED',
      entityType: 'supplier_candidate',
      entityId: row.candidateId,
      payload: {
        decision,
        screeningOnly: true,
        supplierEvidenceFetched: false,
        ...marketAuditFields,
      },
    });
  });
}
