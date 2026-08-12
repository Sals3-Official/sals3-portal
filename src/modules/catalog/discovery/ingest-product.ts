import getDb from '@/lib/db/client';
import type { CjProduct } from '@/lib/cj/normalize';
import type { DiscoverySignal, SupplierConnectionRow } from '@/lib/db/schema';
import resolveBuyerDestinationCountryPolicy from '@/lib/country-policy/buyer-destination-country';
import { computeFingerprint, toFeedSnapshot } from '../candidates/fingerprint';
import {
  appendAuditEvent,
  findCandidateByConnectionAndExternalId,
  insertCandidateIfAbsent,
  insertQueuedEvaluationIfAbsent,
  markCandidateProviderSeen,
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
import {
  releaseNewPidCapacity,
  tryConsumeNewPidCapacity,
} from './intake-gate-repository';
import { recordDiscoverySignal } from './signal-repository';

/**
 * Ingests one discovered supplier product: candidate row, evaluation row
 * with a non-null persisted status, admission audit event, and the
 * EVALUATE_CANDIDATE successor intent - all in ONE durable transaction, so
 * no discovered product can ever exist without a lifecycle status or lose
 * its evaluation job to a crash.
 *
 * Under the lean intake policy (ADR-013 §1a) that successor evaluation is
 * LOCAL screening only. Nothing on this path calls CJ product detail,
 * inventory, comments, or freight, and no AI service is involved; the row's
 * stock-review state starts - and stays - `STOCK_NOT_CHECKED` until a person
 * records a manual CJ/MyCJ inspection.
 *
 * A brand-new PID must also take one unit of the durable new-PID wave ledger,
 * in this same transaction. When the current wave is reached the product is
 * NOT admitted and the caller is told, so it can defer its unit with a
 * resumable checkpoint instead of silently dropping products.
 *
 * Idempotent under re-delivery: candidate/evaluation inserts are
 * create-or-nothing on their unique indexes, the fingerprint requeue is a
 * no-op for unchanged data, signal observations deduplicate on their own
 * unique index, and the outbox intent deduplicates on its idempotency key. A
 * re-observed PID never consumes capacity a second time.
 */

const DISCOVERY_ACTOR_ID = 'system:cj-discovery';

export type IngestOutcome =
  | 'created'
  | 'requeued'
  | 'unchanged'
  /** Refused: the current new-PID wave is full. Nothing was persisted for this product. */
  | 'cap-reached';

export type IngestSignal = {
  signal: DiscoverySignal;
  sourceLane: string;
  sourceQuery: string | null;
  observedListedNum: number | null;
};

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

async function recordSignals(
  tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  candidateId: string,
  signals: IngestSignal[],
): Promise<void> {
  // eslint-disable-next-line no-restricted-syntax -- at most three signals per product.
  for (const entry of signals) {
    // eslint-disable-next-line no-await-in-loop -- see above.
    await recordDiscoverySignal(tx, {
      candidateId,
      signal: entry.signal,
      sourceLane: entry.sourceLane,
      sourceQuery: entry.sourceQuery,
      observedListedNum: entry.observedListedNum,
    });
  }
}

export default async function ingestDiscoveredProduct(
  product: CjProduct,
  connection: SupplierConnectionRow,
  context: {
    cycleId: string | null;
    partitionId: string | null;
    /** Curated-lane observation to attach to this PID, when there is one. */
    signals?: IngestSignal[];
  },
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
  const signals = context.signals ?? [];

  return getDb().transaction(async (tx) => {
    const existingBefore = await findCandidateByConnectionAndExternalId(
      tx,
      connection.id,
      product.id,
    );
    let capacityTaken = false;

    if (existingBefore === null) {
      // A genuinely new unique PID. Take capacity FIRST: if the ceiling is
      // reached, this transaction must persist nothing at all, so the unit
      // of discovery work stays resumable and the count stays exact.
      capacityTaken = await tryConsumeNewPidCapacity(tx, connection.id);

      if (!capacityTaken) return 'cap-reached';
    }

    const created = await insertCandidateIfAbsent(tx, {
      supplier: 'CJ_DROPSHIPPING',
      externalProductId: product.id,
      intendedSellerId: connection.sellerAccountId,
      supplierConnectionId: connection.id,
      intendedMarketCodes: buyerDestinationPolicy.countryCodes,
      providerCategoryId: product.categoryId ?? null,
      providerCategoryName: product.category,
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
          signals: signals.map((entry) => entry.signal),
        },
      });

      await recordSignals(tx, created.id, signals);

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

    // The insert conflicted: a concurrent worker created this candidate
    // between our existence check and our insert, and its transaction took
    // its own capacity unit. Give ours back before continuing as an ordinary
    // re-observation, or one product would consume the ceiling twice.
    if (capacityTaken) await releaseNewPidCapacity(tx, connection.id);

    const existing =
      existingBefore ??
      (await findCandidateByConnectionAndExternalId(
        tx,
        connection.id,
        product.id,
      ));

    if (existing === null) {
      throw new Error(
        'Candidate conflicted on insert but could not be read back.',
      );
    }

    await recordSignals(tx, existing.id, signals);

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

        await markCandidateProviderSeen(tx, existing.id, {
          id: product.categoryId ?? null,
          name: product.category,
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

    await markCandidateProviderSeen(tx, existing.id, {
      id: product.categoryId ?? null,
      name: product.category,
    });

    return requeued ? 'requeued' : 'unchanged';
  });
}
