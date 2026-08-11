import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { DbExecutor } from '@/lib/db/client';
import {
  discoveryAuditUnits,
  discoveryIncrementalWatermarks,
  discoveryPartitionProofs,
  discoveryPartitions,
  discoveryRangeObligations,
  type DiscoveryCycleRow,
  type DiscoveryIncrementalWatermarkRow,
  type DiscoveryPartitionRow,
} from '@/lib/db/schema';
import { INCREMENTAL_SAFETY_OVERLAP_SECONDS } from './config';

const GENERATION_KEY = 'default';

export function generationKey(): string {
  return GENERATION_KEY;
}

export async function findWatermark(
  executor: DbExecutor,
  supplierConnectionId: string,
): Promise<DiscoveryIncrementalWatermarkRow | null> {
  const rows = await executor
    .select()
    .from(discoveryIncrementalWatermarks)
    .where(
      and(
        eq(
          discoveryIncrementalWatermarks.supplierConnectionId,
          supplierConnectionId,
        ),
        eq(discoveryIncrementalWatermarks.generationKey, GENERATION_KEY),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export async function recordBootstrapComplete(
  executor: DbExecutor,
  cycle: DiscoveryCycleRow,
): Promise<void> {
  await executor
    .insert(discoveryIncrementalWatermarks)
    .values({
      supplierConnectionId: cycle.supplierConnectionId,
      generationKey: cycle.generationKey,
      bootstrapCutoff: cycle.cycleCutoff,
      provenCutoff: cycle.cycleCutoff,
      nextWindowFrom: cycle.cycleCutoff,
      safetyOverlapSeconds: INCREMENTAL_SAFETY_OVERLAP_SECONDS,
    })
    .onConflictDoUpdate({
      target: [
        discoveryIncrementalWatermarks.supplierConnectionId,
        discoveryIncrementalWatermarks.generationKey,
      ],
      set: {
        bootstrapCutoff: cycle.cycleCutoff,
        provenCutoff: sql`coalesce(${discoveryIncrementalWatermarks.provenCutoff}, ${cycle.cycleCutoff})`,
        nextWindowFrom: sql`greatest(coalesce(${discoveryIncrementalWatermarks.nextWindowFrom}, ${cycle.cycleCutoff}), ${cycle.cycleCutoff})`,
        updatedAt: new Date(),
      },
    });
}

export async function recordIncrementalWindowTerminal(
  executor: DbExecutor,
  input: { cycle: DiscoveryCycleRow; complete: boolean },
): Promise<void> {
  const watermark = await findWatermark(
    executor,
    input.cycle.supplierConnectionId,
  );
  const nextWindowFrom = input.cycle.cycleCutoff;

  await executor
    .insert(discoveryIncrementalWatermarks)
    .values({
      supplierConnectionId: input.cycle.supplierConnectionId,
      generationKey: input.cycle.generationKey,
      provenCutoff: input.complete
        ? input.cycle.cycleCutoff
        : watermark?.provenCutoff,
      nextWindowFrom,
      safetyOverlapSeconds: INCREMENTAL_SAFETY_OVERLAP_SECONDS,
    })
    .onConflictDoUpdate({
      target: [
        discoveryIncrementalWatermarks.supplierConnectionId,
        discoveryIncrementalWatermarks.generationKey,
      ],
      set: {
        provenCutoff: input.complete
          ? input.cycle.cycleCutoff
          : (watermark?.provenCutoff ?? null),
        nextWindowFrom,
        stateVersion: sql`${discoveryIncrementalWatermarks.stateVersion} + 1`,
        updatedAt: new Date(),
      },
    });
}

export async function recordCycleObligation(
  executor: DbExecutor,
  input: { cycle: DiscoveryCycleRow; reason: string },
): Promise<void> {
  await executor
    .insert(discoveryRangeObligations)
    .values({
      supplierConnectionId: input.cycle.supplierConnectionId,
      lane: input.cycle.lane,
      generationKey: input.cycle.generationKey,
      cycleId: input.cycle.id,
      rangeFrom: input.cycle.windowFrom,
      rangeTo: input.cycle.cycleCutoff,
      reason: input.reason,
      nextRetryAt: new Date(Date.now() + 60 * 60 * 1000),
    })
    .onConflictDoNothing();
}

export async function recordCoveredPartitionProof(
  executor: DbExecutor,
  partitionId: string,
): Promise<void> {
  const rows = await executor
    .select({
      partition: discoveryPartitions,
    })
    .from(discoveryPartitions)
    .where(eq(discoveryPartitions.id, partitionId))
    .limit(1);
  const partition = rows[0]?.partition;

  if (
    partition === undefined ||
    partition.state !== 'COVERED' ||
    partition.reportedTotal === null ||
    partition.uniquePidCount === null ||
    partition.passChecksums.length === 0
  ) {
    return;
  }

  await executor
    .insert(discoveryPartitionProofs)
    .values({
      supplierConnectionId: partition.supplierConnectionId,
      sourcePartitionId: partition.id,
      generationKey: GENERATION_KEY,
      categoryId: partition.categoryId,
      createTimeFromMs: partition.createTimeFromMs,
      createTimeToMs: partition.createTimeToMs,
      priceFromCents: partition.priceFromCents,
      priceToCents: partition.priceToCents,
      providerTotal: partition.reportedTotal,
      uniquePidCount: partition.uniquePidCount,
      sortedPidChecksum:
        partition.passChecksums[partition.passChecksums.length - 1]!,
      nextAuditDueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      auditRiskReason: 'BOOTSTRAP_PROOF',
    })
    .onConflictDoUpdate({
      target: [
        discoveryPartitionProofs.supplierConnectionId,
        discoveryPartitionProofs.generationKey,
        discoveryPartitionProofs.categoryId,
        discoveryPartitionProofs.createTimeFromMs,
        discoveryPartitionProofs.createTimeToMs,
        discoveryPartitionProofs.priceFromCents,
        discoveryPartitionProofs.priceToCents,
      ],
      set: {
        providerTotal: partition.reportedTotal,
        uniquePidCount: partition.uniquePidCount,
        sortedPidChecksum:
          partition.passChecksums[partition.passChecksums.length - 1]!,
        lastVerifiedAt: new Date(),
        updatedAt: new Date(),
      },
    });
}

export async function listDueAuditUnits(
  executor: DbExecutor,
  input: { limit: number },
): Promise<DiscoveryPartitionRow[]> {
  const rows = await executor
    .select()
    .from(discoveryPartitions)
    .innerJoin(
      discoveryPartitionProofs,
      eq(discoveryPartitionProofs.sourcePartitionId, discoveryPartitions.id),
    )
    .leftJoin(
      discoveryAuditUnits,
      eq(discoveryAuditUnits.partitionProofId, discoveryPartitionProofs.id),
    )
    .where(isNull(discoveryAuditUnits.id))
    .orderBy(asc(discoveryPartitionProofs.nextAuditDueAt))
    .limit(input.limit);

  return rows.map((row) => row.discovery_partitions);
}
