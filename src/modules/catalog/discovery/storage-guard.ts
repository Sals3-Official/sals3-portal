import { sql } from 'drizzle-orm';
import type { DbExecutor } from '@/lib/db/client';
import {
  STORAGE_ALLOWANCE_BYTES,
  STORAGE_PAUSE_PERCENT,
  STORAGE_WARN_PERCENT,
} from './config';

/**
 * Neon development-pilot capacity guard: warn at ~70% of the configured
 * allowance, pause NEW broad discovery at ~80%. Never deletes accumulated
 * product/evidence records - the guard only stops adding load. Neon Free's
 * 0.5 GB allowance may not fit the entire CJ catalogue; the architecture
 * supports full scale, but the free pilot must not be represented as
 * production-ready full-catalogue capacity (see README).
 */

export type StorageGuardStatus = {
  usedBytes: number;
  allowanceBytes: number;
  usedPercent: number;
  warn: boolean;
  pauseBroadDiscovery: boolean;
};

export default async function checkStorageGuard(
  executor: DbExecutor,
): Promise<StorageGuardStatus> {
  const rows = await executor.execute(
    sql`SELECT pg_database_size(current_database()) AS used_bytes`,
  );

  const first = (rows as unknown as Array<{ used_bytes: unknown }>)[0];
  const usedBytes = Number(first?.used_bytes ?? 0);
  const usedPercent =
    STORAGE_ALLOWANCE_BYTES <= 0
      ? 0
      : Math.round((usedBytes / STORAGE_ALLOWANCE_BYTES) * 100);

  return {
    usedBytes,
    allowanceBytes: STORAGE_ALLOWANCE_BYTES,
    usedPercent,
    warn: usedPercent >= STORAGE_WARN_PERCENT,
    pauseBroadDiscovery: usedPercent >= STORAGE_PAUSE_PERCENT,
  };
}
