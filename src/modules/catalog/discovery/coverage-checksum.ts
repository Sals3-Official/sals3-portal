import { createHash } from 'crypto';

/**
 * Coverage-proof checksum for atomic-bucket reconciliation (ADR-013 §3):
 * SHA-256 over the SORTED unique PID set plus the immutable partition
 * identity, so two complete enumeration passes prove stability only when
 * they saw exactly the same set for exactly the same filters. Sorting makes
 * the checksum order-independent; binding the partition identity means a
 * checksum can never be replayed across partitions or cycles.
 */
export default function coverageChecksum(input: {
  partitionId: string;
  categoryId: string;
  timeFromMs: number | null;
  timeToMs: number;
  priceFromCents: number | null;
  priceToCents: number | null;
  uniquePids: readonly string[];
}): string {
  const sorted = [...input.uniquePids].sort();
  const identity = JSON.stringify([
    input.partitionId,
    input.categoryId,
    input.timeFromMs,
    input.timeToMs,
    input.priceFromCents,
    input.priceToCents,
  ]);

  return createHash('sha256')
    .update(identity)
    .update('\n')
    .update(sorted.join('\n'))
    .digest('hex');
}
