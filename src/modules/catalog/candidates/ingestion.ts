import getDb from '@/lib/db/client';
import { fetchCjProducts } from '@/services/cj/products';
import { computeFingerprint, toFeedSnapshot } from './fingerprint';
import {
  findCandidateByExternalId,
  insertCandidateIfAbsent,
  insertQueuedEvaluationIfAbsent,
  requeueIfFingerprintChanged,
} from './repository';
import { POLICY_VERSION } from './rules/policy';

/**
 * Ingests the CJ product feed: every unseen `pid` becomes a shortlisted
 * candidate with a `QUEUED` evaluation, replacing the old per-row "Check for
 * Sals3" click (spec's automated flow, step 1). A `pid` already decided
 * (`PASS`/`PASS_WITH_ATTENTION`/`BLOCKED`/`TEMPORARILY_INELIGIBLE`) is only
 * re-queued when its cheap feed fingerprint changed - unchanged rows are left
 * alone so a cron tick does not re-spend CJ evidence points for nothing
 * (cost-efficiency rule 52).
 *
 * `intendedSellerId`/`actorId` stay the current single dev/official seller
 * context (`seller-001`) - unchanged from the existing manual shortlist flow.
 * No multi-seller ingestion exists; that is the separate, deferred task.
 */

const INGESTION_SELLER_ID = 'seller-001';
const INGESTION_ACTOR_ID = 'system:cj-ingestion';
const INGESTION_MARKET_CODES = ['PH'];
const MAX_PAGES_PER_TICK = 5;

export type IngestionResult = {
  pagesFetched: number;
  candidatesSeen: number;
  candidatesCreated: number;
  candidatesRequeued: number;
};

export default async function ingestCjFeed(): Promise<IngestionResult> {
  const result: IngestionResult = {
    pagesFetched: 0,
    candidatesSeen: 0,
    candidatesCreated: 0,
    candidatesRequeued: 0,
  };

  for (let page = 1; page <= MAX_PAGES_PER_TICK; page += 1) {
    // eslint-disable-next-line no-await-in-loop -- CJ allows one request per second; pages must be sequential.
    const feedPage = await fetchCjProducts({
      cjPage: page,
      cjSearch: '',
      cjPid: '',
    });
    result.pagesFetched += 1;

    // eslint-disable-next-line no-await-in-loop -- one product at a time, inside one DB transaction each.
    await Promise.all(
      feedPage.products.map(async (product) => {
        result.candidatesSeen += 1;

        const fingerprint = computeFingerprint(product);
        const feedSnapshot = toFeedSnapshot(product);

        await getDb().transaction(async (tx) => {
          const created = await insertCandidateIfAbsent(tx, {
            supplier: 'CJ_DROPSHIPPING',
            externalProductId: product.id,
            intendedSellerId: INGESTION_SELLER_ID,
            intendedMarketCodes: INGESTION_MARKET_CODES,
            actorId: INGESTION_ACTOR_ID,
          });

          if (created !== null) {
            await insertQueuedEvaluationIfAbsent(tx, {
              candidateId: created.id,
              feedSnapshot,
              fingerprint,
              policyVersion: POLICY_VERSION,
            });
            result.candidatesCreated += 1;
            return;
          }

          const existing = await findCandidateByExternalId(
            tx,
            'CJ_DROPSHIPPING',
            product.id,
          );

          if (existing === null) {
            throw new Error(
              'Candidate conflicted on insert but could not be read back.',
            );
          }

          const requeued = await requeueIfFingerprintChanged(tx, {
            candidateId: existing.id,
            feedSnapshot,
            fingerprint,
          });

          if (requeued) result.candidatesRequeued += 1;
        });
      }),
    );

    if (page >= feedPage.totalPages) break;
  }

  return result;
}
