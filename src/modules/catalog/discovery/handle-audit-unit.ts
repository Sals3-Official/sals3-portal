import getDb from '@/lib/db/client';
import { AUDIT_SWEEP_DELAY_SECONDS, SEED_BATCH_SIZE } from './config';
import type { DiscoveryAuditUnitMessage } from './messages';
import { listDueAuditUnits } from './lane-repository';
import { insertOutboxIntents } from './outbox-repository';
import { partitionMessageIntent } from './handle-cycle-start';

export default async function handleAuditUnit(
  message: DiscoveryAuditUnitMessage,
): Promise<void> {
  const due = await listDueAuditUnits(getDb(), { limit: SEED_BATCH_SIZE });

  await insertOutboxIntents(getDb(), [
    ...due.map((partition) =>
      partitionMessageIntent({
        supplierConnectionId: message.supplierConnectionId,
        cycleId: partition.cycleId,
        partitionId: partition.id,
        keySuffix: `audit:${Math.floor(Date.now() / (AUDIT_SWEEP_DELAY_SECONDS * 1000))}`,
      }),
    ),
    {
      message: {
        v: 1,
        operation: 'DISCOVERY_AUDIT_UNIT',
        idempotencyKey: `audit:${message.supplierConnectionId}:${Math.floor(Date.now() / (AUDIT_SWEEP_DELAY_SECONDS * 1000))}`,
        supplierConnectionId: message.supplierConnectionId,
      },
      delaySeconds: AUDIT_SWEEP_DELAY_SECONDS,
    },
  ]);
}
