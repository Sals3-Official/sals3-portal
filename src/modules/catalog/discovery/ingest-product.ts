import getDb from '@/lib/db/client';
import type { CjProduct } from '@/lib/cj/normalize';
import type { SupplierConnectionRow } from '@/lib/db/schema';
import resolveBuyerDestinationCountryPolicy from '@/lib/country-policy/buyer-destination-country';
import { computeFingerprint, toFeedSnapshot } from '../candidates/fingerprint';
import {
  appendAuditEvent,
  findCandidateByConnectionAndExternalId,
  insertCandidateIfAbsent,
  insertQueuedEvaluationIfAbsent,
  recordScreeningDecision,
  requeueIfFingerprintChanged,
} from '../candidates/repository';
import {
  composeEvaluationPolicyVersion,
  POLICY_VERSION,
} from '../candidates/rules/policy';
import { decide } from '../candidates/rules/decide';
import { checkValidMarket } from '../candidates/rules/screening';
import { insertOutboxIntents } from './outbox-repository';

/**
 * Ingests one discovered supplier product: candidate row, evaluation row
 * with a non-null persisted status, admission audit event, and the
 * EVALUATE_CANDIDATE successor intent - all in ONE durable transaction, so
 * no discovered product can ever exist without a lifecycle status or lose
 * its evaluation job to a crash (turnover: "Assign a persisted status
 * immediately to every discovered product").
 *
 * Status vocabulary note: the discovered-and-admitted state IS the existing
 * `QUEUED` status - the same transaction that persists the discovery also
 * persists the evaluation admission, so a separate `DISCOVERED` status would
 * be a duplicate synonym of an approved existing value (turnover: "use
 * existing repository vocabulary when an approved equivalent already
 * exists").
 *
 * Idempotent under re-delivery: candidate/evaluation inserts are
 * create-or-nothing on their unique indexes, the fingerprint requeue is a
 * no-op for unchanged data, and the outbox intent deduplicates on its
 * idempotency key.
 */

const DISCOVERY_ACTOR_ID = 'system:cj-discovery';

export type IngestOutcome = 'created' | 'requeued' | 'unchanged';

function noValidMarketDecision(
  buyerDestinationPolicy: ReturnType<
    typeof resolveBuyerDestinationCountryPolicy
  >,
  candidateDestinationCodes: string[],
) {
  const marketFinding = checkValidMarket({
    buyerDestinationPolicy,
    candidateDestinationCodes,
  });

  if (marketFinding?.reasonCode !== 'NO_VALID_MARKET') return null;

  return decide([marketFinding]);
}

export default async function ingestDiscoveredProduct(
  product: CjProduct,
  connection: SupplierConnectionRow,
  context: { cycleId: string; partitionId: string },
): Promise<IngestOutcome> {
  const fingerprint = computeFingerprint(product);
  const feedSnapshot = toFeedSnapshot(product);
  // Buyer destination-country eligibility only - never the seller operating
  // country or a supplier stock-origin country (ADR-014).
  const buyerDestinationPolicy = resolveBuyerDestinationCountryPolicy();
  const evaluationPolicyVersion = composeEvaluationPolicyVersion(
    POLICY_VERSION,
    buyerDestinationPolicy.policyVersion,
  );
  const newCandidateMarketDecision = noValidMarketDecision(
    buyerDestinationPolicy,
    buyerDestinationPolicy.countryCodes,
  );

  return getDb().transaction(async (tx) => {
    const created = await insertCandidateIfAbsent(tx, {
      supplier: 'CJ_DROPSHIPPING',
      externalProductId: product.id,
      intendedSellerId: connection.sellerAccountId,
      supplierConnectionId: connection.id,
      intendedMarketCodes: buyerDestinationPolicy.countryCodes,
      actorId: DISCOVERY_ACTOR_ID,
    });

    if (created !== null) {
      await insertQueuedEvaluationIfAbsent(tx, {
        candidateId: created.id,
        feedSnapshot,
        fingerprint,
        policyVersion: POLICY_VERSION,
      });
      await appendAuditEvent(tx, {
        actorId: DISCOVERY_ACTOR_ID,
        action: 'CANDIDATE_DISCOVERED',
        entityType: 'supplier_candidate',
        entityId: created.id,
        payload: {
          admissionReason: 'NEW_PRODUCT',
          cycleId: context.cycleId,
          partitionId: context.partitionId,
          fingerprint,
        },
      });

      if (newCandidateMarketDecision !== null) {
        await recordScreeningDecision(tx, {
          candidateId: created.id,
          decision: newCandidateMarketDecision,
          policyVersion: evaluationPolicyVersion,
        });

        return 'created';
      }

      await insertOutboxIntents(tx, [
        {
          message: {
            v: 1,
            operation: 'EVALUATE_CANDIDATE',
            idempotencyKey: `evaluate:${created.id}:${evaluationPolicyVersion}:${fingerprint}`,
            candidateId: created.id,
            policyVersion: evaluationPolicyVersion,
            admissionReason: 'NEW_PRODUCT',
          },
        },
      ]);

      return 'created';
    }

    const existing = await findCandidateByConnectionAndExternalId(
      tx,
      connection.id,
      product.id,
    );

    if (existing === null) {
      throw new Error(
        'Candidate conflicted on insert but could not be read back.',
      );
    }

    const existingCandidateMarketDecision = noValidMarketDecision(
      buyerDestinationPolicy,
      existing.intendedMarketCodes,
    );

    const requeued = await requeueIfFingerprintChanged(tx, {
      candidateId: existing.id,
      feedSnapshot,
      fingerprint,
    });

    if (requeued) {
      await appendAuditEvent(tx, {
        actorId: DISCOVERY_ACTOR_ID,
        action: 'CANDIDATE_REQUEUED_MATERIAL_CHANGE',
        entityType: 'supplier_candidate',
        entityId: existing.id,
        payload: {
          admissionReason: 'MATERIAL_SOURCE_CHANGE',
          cycleId: context.cycleId,
          partitionId: context.partitionId,
          fingerprint,
        },
      });

      if (existingCandidateMarketDecision !== null) {
        await recordScreeningDecision(tx, {
          candidateId: existing.id,
          decision: existingCandidateMarketDecision,
          policyVersion: evaluationPolicyVersion,
        });

        return 'requeued';
      }

      await insertOutboxIntents(tx, [
        {
          message: {
            v: 1,
            operation: 'EVALUATE_CANDIDATE',
            idempotencyKey: `evaluate:${existing.id}:${evaluationPolicyVersion}:${fingerprint}`,
            candidateId: existing.id,
            policyVersion: evaluationPolicyVersion,
            admissionReason: 'MATERIAL_SOURCE_CHANGE',
          },
        },
      ]);
    }

    return requeued ? 'requeued' : 'unchanged';
  });
}
