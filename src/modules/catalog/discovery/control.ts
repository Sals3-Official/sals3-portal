import getDb from '@/lib/db/client';
import { listWorkableConnections } from '@/modules/suppliers/repository';
import { setDesiredRunState } from './run-state-repository';
import { createCycleIfAbsent, findActiveCycle } from './cycle-repository';
import { ensureBudgetRow } from './budget-repository';
import { insertOutboxIntents } from './outbox-repository';
import { cycleStartIntent } from './handle-cycle-start';
import dispatchOutbox from './outbox-dispatch';

/**
 * Owner control actions behind the protected internal routes. Start and
 * Resume are idempotent: they converge on "run state RUNNING, one active
 * cycle, one chain of queue messages" however many times they are called,
 * and two concurrent calls cannot create two chains (the cycle table's
 * partial unique index arbitrates). A successful initial Start creates the
 * durable queue chain; after that, Vercel's managed queue continues while
 * the owner's browser and PC are closed.
 */

export type ControlResult = {
  supplierConnectionId: string;
  action: 'START' | 'PAUSE' | 'RESUME';
  runState: 'RUNNING' | 'PAUSED';
  cycleId: string | null;
  cycleCreated: boolean;
  /**
   * Whether the chain kick-off message actually reached the queue. False
   * means the intent is durably PENDING in the outbox but NOT published -
   * and with no queue delivery in flight yet, nothing would drain it, so
   * the route must surface this as a failure and the owner must retry
   * Start/Resume (idempotent). Always true for PAUSE.
   */
  chainDispatched: boolean;
};

async function startOrResumeConnection(
  connectionId: string,
  action: 'START' | 'RESUME',
): Promise<ControlResult> {
  const db = getDb();

  await setDesiredRunState(db, {
    supplierConnectionId: connectionId,
    desiredState: 'RUNNING',
    action,
  });
  await ensureBudgetRow(db, connectionId);

  const { cycle, created } = await createCycleIfAbsent(db, {
    supplierConnectionId: connectionId,
    cycleCutoff: new Date(),
  });

  // The kick-off/sweep message: idempotent ensure-and-sweep, so calling
  // Start/Resume repeatedly only re-heals the same chain.
  await insertOutboxIntents(db, [
    cycleStartIntent({
      supplierConnectionId: connectionId,
      cycleId: cycle.id,
      keySuffix: `${action.toLowerCase()}:${cycle.id}:${Date.now()}`,
    }),
  ]);

  // This drain result MUST be checked: at initial start there is no queue
  // delivery in flight yet, so a failed publish here has nothing to
  // redeliver-and-drain later - the chain simply would not begin. A failure
  // is reported to the owner (Start/Resume are idempotent retries).
  const drain = await dispatchOutbox();

  return {
    supplierConnectionId: connectionId,
    action,
    runState: 'RUNNING',
    cycleId: cycle.id,
    cycleCreated: created,
    chainDispatched: drain.failed === 0,
  };
}

async function pauseConnection(connectionId: string): Promise<ControlResult> {
  const db = getDb();

  await setDesiredRunState(db, {
    supplierConnectionId: connectionId,
    desiredState: 'PAUSED',
    action: 'PAUSE',
  });

  const active = await findActiveCycle(db, connectionId);

  return {
    supplierConnectionId: connectionId,
    action: 'PAUSE',
    runState: 'PAUSED',
    cycleId: active?.id ?? null,
    cycleCreated: false,
    chainDispatched: true,
  };
}

/**
 * Applies one control action to every workable connection (or one specific
 * connection when given). Connections that are not workable are skipped -
 * discovery through a disconnected/revoked connection is a connection-
 * health matter, not a control-plane one.
 */
export default async function applyDiscoveryControl(input: {
  action: 'START' | 'PAUSE' | 'RESUME';
  supplierConnectionId?: string;
}): Promise<ControlResult[]> {
  const db = getDb();
  const connections = await listWorkableConnections(db);
  const targets =
    input.supplierConnectionId === undefined
      ? connections
      : connections.filter((c) => c.id === input.supplierConnectionId);

  const results: ControlResult[] = [];

  // eslint-disable-next-line no-restricted-syntax -- a handful of connections; sequential keeps control actions easy to reason about.
  for (const connection of targets) {
    const result =
      input.action === 'PAUSE'
        ? // eslint-disable-next-line no-await-in-loop -- see above.
          await pauseConnection(connection.id)
        : // eslint-disable-next-line no-await-in-loop -- see above.
          await startOrResumeConnection(connection.id, input.action);

    results.push(result);
  }

  return results;
}
