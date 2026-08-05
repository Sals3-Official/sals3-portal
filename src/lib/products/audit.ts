import type { AuditEntry } from './types';

/** Calendar date in ISO form. The audit trail records days, not clock times. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

let sequence = 0;

/**
 * One audit-trail row: who changed what, the old value, the new value, and
 * when. Every write path appends at least one of these, so a product's history
 * is never silently rewritten.
 */
export function auditEntry(
  actor: string,
  field: string,
  from: string,
  to: string,
): AuditEntry {
  sequence += 1;

  return {
    id: `audit-${todayIso()}-${sequence}`,
    actor,
    field,
    from,
    to,
    at: todayIso(),
  };
}

/** Field-by-field differences between two records, for the audit trail. */
export function diffFields(
  before: Record<string, string>,
  after: Record<string, string>,
): Array<{ field: string; from: string; to: string }> {
  return Object.keys(after)
    .filter((key) => before[key] !== after[key])
    .map((key) => ({
      field: key,
      from: before[key] ?? '—',
      to: after[key] ?? '—',
    }));
}
