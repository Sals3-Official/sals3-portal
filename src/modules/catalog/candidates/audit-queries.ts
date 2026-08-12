import { and, desc, eq } from 'drizzle-orm';
import type { DbExecutor } from '@/lib/db/client';
import { auditEvents, type AuditEventRow } from '@/lib/db/schema';

/**
 * Read side of the append-only audit log, for one entity.
 *
 * Lives outside `repository.ts` because that file serves the write use cases -
 * `appendAuditEvent` is there - and a read path should not be able to reach a
 * mutation helper by accident.
 *
 * `audit_events` has NO tenant column: it is scoped only by `entityType` +
 * `entityId`. Every caller must therefore prove the entity belongs to the
 * reading seller BEFORE calling this. `resolveCandidateDetail` does exactly
 * that, and only reaches here after its seller-scoped gate query returns a row.
 */

/** Bounded so one noisy candidate cannot render an unbounded page. */
const MAX_EVENTS = 50;

export default async function listAuditEventsForEntity(
  executor: DbExecutor,
  input: { entityType: string; entityId: string; limit?: number },
): Promise<AuditEventRow[]> {
  return executor
    .select()
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.entityType, input.entityType),
        eq(auditEvents.entityId, input.entityId),
      ),
    )
    .orderBy(desc(auditEvents.createdAt))
    .limit(Math.min(Math.max(input.limit ?? MAX_EVENTS, 1), MAX_EVENTS));
}
