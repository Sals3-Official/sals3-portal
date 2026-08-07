import getDb from '@/lib/db/client';
import type { CjProduct } from '@/lib/cj/normalize';
import PostgresSupplierSecretStore from '@/lib/secrets/postgres-supplier-secret-store';
import { listWorkableConnections } from '@/modules/suppliers/repository';
import type { SupplierConnectionRow } from '@/lib/db/schema';
import CjTokenManager from '@/modules/suppliers/providers/cj/cj-auth';
import CjSupplierAdapter from '@/modules/suppliers/providers/cj/cj-adapter';
import { computeFingerprint, toFeedSnapshot } from './fingerprint';
import {
  findCandidateByConnectionAndExternalId,
  insertCandidateIfAbsent,
  insertQueuedEvaluationIfAbsent,
  requeueIfFingerprintChanged,
} from './repository';
import { POLICY_VERSION } from './rules/policy';

/**
 * Ingests every workable supplier connection's CJ feed (ADR-008): each
 * connection is its own seller's own credentialed CJ account, resolved
 * through `CjSupplierAdapter` instead of the retired global `CJ_API_KEY`
 * path. A candidate's shortlist row carries `supplierConnectionId` as the
 * source of truth for tenant scoping - see spec section 26 and
 * `repository.ts`'s "BACKGROUND-JOB DRIZZLE PATTERN" note.
 *
 * `intendedSellerId` (legacy text field, pre-dates connections) is set to
 * the connection's own `sellerAccountId` for display continuity - nothing
 * reads it as the source of truth anymore.
 */

const INGESTION_ACTOR_ID = 'system:cj-ingestion';
const INGESTION_MARKET_CODES = ['PH'];
const MAX_PAGES_PER_TICK_PER_CONNECTION = 5;

export type IngestionResult = {
  connectionsProcessed: number;
  pagesFetched: number;
  candidatesSeen: number;
  candidatesCreated: number;
  candidatesRequeued: number;
};

type ProductOutcome = 'created' | 'requeued' | 'unchanged';

async function ingestProduct(
  product: CjProduct,
  connection: SupplierConnectionRow,
): Promise<ProductOutcome> {
  const fingerprint = computeFingerprint(product);
  const feedSnapshot = toFeedSnapshot(product);

  return getDb().transaction(async (tx) => {
    const created = await insertCandidateIfAbsent(tx, {
      supplier: 'CJ_DROPSHIPPING',
      externalProductId: product.id,
      intendedSellerId: connection.sellerAccountId,
      supplierConnectionId: connection.id,
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

    const requeued = await requeueIfFingerprintChanged(tx, {
      candidateId: existing.id,
      feedSnapshot,
      fingerprint,
    });

    return requeued ? 'requeued' : 'unchanged';
  });
}

type ConnectionIngestionTally = Omit<IngestionResult, 'connectionsProcessed'>;

async function ingestConnection(
  connection: SupplierConnectionRow,
  adapter: CjSupplierAdapter,
): Promise<ConnectionIngestionTally> {
  const tally: ConnectionIngestionTally = {
    pagesFetched: 0,
    candidatesSeen: 0,
    candidatesCreated: 0,
    candidatesRequeued: 0,
  };

  for (let page = 1; page <= MAX_PAGES_PER_TICK_PER_CONNECTION; page += 1) {
    // eslint-disable-next-line no-await-in-loop -- CJ allows one request per second per connection; pages must be sequential.
    const feedPage = await adapter.listCandidates(connection.id, {
      page,
      search: '',
      pid: '',
    });
    tally.pagesFetched += 1;
    tally.candidatesSeen += feedPage.products.length;

    // eslint-disable-next-line no-await-in-loop -- one product at a time, inside one DB transaction each.
    const outcomes = await Promise.all(
      feedPage.products.map((product) => ingestProduct(product, connection)),
    );

    tally.candidatesCreated += outcomes.filter((o) => o === 'created').length;
    tally.candidatesRequeued += outcomes.filter((o) => o === 'requeued').length;

    if (page >= feedPage.totalPages) break;
  }

  return tally;
}

export default async function ingestCjFeed(): Promise<IngestionResult> {
  const connections = await listWorkableConnections(getDb());
  const secretStore = new PostgresSupplierSecretStore();
  const tokenManager = new CjTokenManager(secretStore);
  const adapter = new CjSupplierAdapter(secretStore, tokenManager);

  const tallies: ConnectionIngestionTally[] = [];

  // eslint-disable-next-line no-restricted-syntax -- each connection's CJ rate limit is independent, but sequential per-connection keeps one tick's total CJ traffic bounded and easy to reason about for a phase-1 handful of connections.
  for (const connection of connections) {
    // eslint-disable-next-line no-await-in-loop -- see above.
    tallies.push(await ingestConnection(connection, adapter));
  }

  return tallies.reduce<IngestionResult>(
    (total, tally) => ({
      connectionsProcessed: total.connectionsProcessed + 1,
      pagesFetched: total.pagesFetched + tally.pagesFetched,
      candidatesSeen: total.candidatesSeen + tally.candidatesSeen,
      candidatesCreated: total.candidatesCreated + tally.candidatesCreated,
      candidatesRequeued: total.candidatesRequeued + tally.candidatesRequeued,
    }),
    {
      connectionsProcessed: 0,
      pagesFetched: 0,
      candidatesSeen: 0,
      candidatesCreated: 0,
      candidatesRequeued: 0,
    },
  );
}
