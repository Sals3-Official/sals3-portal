import { eq } from 'drizzle-orm';
import type { DbExecutor } from '@/lib/db/client';
import { discoveryRunStates, type DiscoveryRunStateRow } from '@/lib/db/schema';

/**
 * Operational run/pause state per connection. Start and Resume are
 * idempotent by construction (upsert + unconditional desired-state write);
 * pausing prevents NEW supplier work while retaining every checkpoint and
 * queue/database state - in-flight work may finish its local transaction
 * but must not begin new supplier work after observing PAUSED.
 */

export async function findRunState(
  executor: DbExecutor,
  supplierConnectionId: string,
): Promise<DiscoveryRunStateRow | null> {
  const rows = await executor
    .select()
    .from(discoveryRunStates)
    .where(eq(discoveryRunStates.supplierConnectionId, supplierConnectionId))
    .limit(1);

  return rows[0] ?? null;
}

export async function isDiscoveryRunning(
  executor: DbExecutor,
  supplierConnectionId: string,
): Promise<boolean> {
  const row = await findRunState(executor, supplierConnectionId);

  return row !== null && row.desiredState === 'RUNNING';
}

/**
 * Sets the desired run state, creating the row when absent. Returns the
 * resulting row. Calling with the current state is a harmless no-op update
 * (idempotent start/pause/resume).
 */
export async function setDesiredRunState(
  executor: DbExecutor,
  input: {
    supplierConnectionId: string;
    desiredState: 'RUNNING' | 'PAUSED';
    action: 'START' | 'PAUSE' | 'RESUME';
  },
): Promise<DiscoveryRunStateRow> {
  const now = new Date();
  let timestamps: Partial<{
    lastStartedAt: Date;
    lastPausedAt: Date;
    lastResumedAt: Date;
  }>;

  if (input.action === 'START') {
    timestamps = { lastStartedAt: now };
  } else if (input.action === 'PAUSE') {
    timestamps = { lastPausedAt: now };
  } else {
    timestamps = { lastResumedAt: now };
  }

  const inserted = await executor
    .insert(discoveryRunStates)
    .values({
      supplierConnectionId: input.supplierConnectionId,
      desiredState: input.desiredState,
      ...timestamps,
    })
    .onConflictDoNothing({ target: discoveryRunStates.supplierConnectionId })
    .returning();

  if (inserted[0] !== undefined) return inserted[0];

  const updated = await executor
    .update(discoveryRunStates)
    .set({
      desiredState: input.desiredState,
      ...timestamps,
      updatedAt: now,
    })
    .where(
      eq(discoveryRunStates.supplierConnectionId, input.supplierConnectionId),
    )
    .returning();

  if (updated[0] === undefined) {
    throw new Error('Run state conflicted on insert but could not be updated.');
  }

  return updated[0];
}
