import { and, eq, sql } from 'drizzle-orm';
import type { DbExecutor } from '@/lib/db/client';
import {
  candidateDiscoverySignals,
  supplierCandidates,
  type DiscoverySignal,
} from '@/lib/db/schema';

/**
 * CJ discovery-signal observations (`CJ_TRENDING`, `CJ_HIGH_LISTED`,
 * `CJ_NEW_ARRIVAL`).
 *
 * These are supplier ranking evidence and nothing more. Recording one must
 * never change a candidate's lifecycle status, market eligibility, or manual
 * stock-review state - which is why this repository writes to exactly one
 * table and touches no other, and why nothing here can produce a `READY`
 * claim. In particular `CJ_HIGH_LISTED` derives from `listedNum`, which CJ
 * documents as the number of platform listings, never units sold.
 */

export type SignalObservation = {
  candidateId: string;
  signal: DiscoverySignal;
  sourceLane: string;
  /** Redacted filter description - never a token, credential, or full URL. */
  sourceQuery: string | null;
  observedListedNum: number | null;
};

/**
 * Upsert-once semantics: the `(candidate_id, signal)` unique index IS the
 * deduplication, so a duplicate queue delivery or two concurrent curated
 * workers create exactly one logical observation. A repeat sighting refreshes
 * `lastObservedAt`/`observationCount`/`observedListedNum` and preserves
 * `firstObservedAt`.
 */
export async function recordDiscoverySignal(
  executor: DbExecutor,
  observation: SignalObservation,
): Promise<void> {
  const now = new Date();

  await executor
    .insert(candidateDiscoverySignals)
    .values({
      candidateId: observation.candidateId,
      signal: observation.signal,
      sourceLane: observation.sourceLane,
      sourceQuery: observation.sourceQuery,
      observedListedNum: observation.observedListedNum,
      firstObservedAt: now,
      lastObservedAt: now,
      observationCount: 1,
    })
    .onConflictDoUpdate({
      target: [
        candidateDiscoverySignals.candidateId,
        candidateDiscoverySignals.signal,
      ],
      set: {
        lastObservedAt: now,
        sourceLane: observation.sourceLane,
        sourceQuery: observation.sourceQuery,
        observedListedNum: observation.observedListedNum,
        observationCount: sql`${candidateDiscoverySignals.observationCount} + 1`,
      },
    });
}

/**
 * Signals for one page of candidates, grouped by candidate id. One query for
 * the whole page rather than one per row - the catalogue table renders
 * hundreds of rows and must not fan out into N+1 reads.
 */
export async function findSignalsByCandidateIds(
  executor: DbExecutor,
  candidateIds: string[],
): Promise<Map<string, DiscoverySignal[]>> {
  if (candidateIds.length === 0) return new Map();

  const rows = await executor
    .select({
      candidateId: candidateDiscoverySignals.candidateId,
      signal: candidateDiscoverySignals.signal,
    })
    .from(candidateDiscoverySignals)
    .where(
      sql`${candidateDiscoverySignals.candidateId} = ANY(${sql.param(candidateIds)}::uuid[])`,
    );

  const grouped = new Map<string, DiscoverySignal[]>();

  rows.forEach((row) => {
    const existing = grouped.get(row.candidateId);

    if (existing === undefined) {
      grouped.set(row.candidateId, [row.signal]);
      return;
    }

    existing.push(row.signal);
  });

  return grouped;
}

/**
 * Does this seller's connection already carry the signal for this candidate?
 * Used only by tests and the status read model; the write path relies on the
 * unique index instead of a check-then-write.
 */
export async function countSignalsForConnection(
  executor: DbExecutor,
  input: { supplierConnectionId: string; signal: DiscoverySignal },
): Promise<number> {
  const rows = await executor
    .select({ total: sql<number>`count(*)` })
    .from(candidateDiscoverySignals)
    .innerJoin(
      supplierCandidates,
      eq(supplierCandidates.id, candidateDiscoverySignals.candidateId),
    )
    .where(
      and(
        eq(supplierCandidates.supplierConnectionId, input.supplierConnectionId),
        eq(candidateDiscoverySignals.signal, input.signal),
      ),
    );

  return Number(rows[0]?.total ?? 0);
}
