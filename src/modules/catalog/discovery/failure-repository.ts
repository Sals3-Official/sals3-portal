import { desc, gte, sql } from 'drizzle-orm';
import type { DbExecutor } from '@/lib/db/client';
import { discoveryFailures, type DiscoveryFailureRow } from '@/lib/db/schema';

/**
 * Append-only operational failure visibility - the application-level
 * dead-letter record Vercel Queues does not provide (ADR-013 §12).
 * `detail` is redacted by every caller: never a secret, token, signature,
 * or raw supplier payload.
 */

export async function recordDiscoveryFailure(
  executor: DbExecutor,
  input: {
    scope: string;
    referenceId: string;
    errorCode: string;
    detail?: string;
    attempts?: number;
  },
): Promise<void> {
  await executor.insert(discoveryFailures).values({
    scope: input.scope,
    referenceId: input.referenceId,
    errorCode: input.errorCode,
    detail: input.detail ?? null,
    attempts: input.attempts ?? 0,
  });
}

export async function listRecentFailures(
  executor: DbExecutor,
  input: { since: Date; limit: number },
): Promise<DiscoveryFailureRow[]> {
  return executor
    .select()
    .from(discoveryFailures)
    .where(gte(discoveryFailures.createdAt, input.since))
    .orderBy(desc(discoveryFailures.createdAt))
    .limit(input.limit);
}

export async function countRecentFailures(
  executor: DbExecutor,
  since: Date,
): Promise<number> {
  const rows = await executor
    .select({ total: sql<number>`count(*)` })
    .from(discoveryFailures)
    .where(gte(discoveryFailures.createdAt, since));

  return Number(rows[0]?.total ?? 0);
}
