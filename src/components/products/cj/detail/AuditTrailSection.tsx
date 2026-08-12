import DetailSection from '@/components/portal/DetailSection';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import formatUtcDateTime from '@/lib/portal/format-datetime';
import type { AuditEventRow } from '@/lib/db/schema';
import CandidateAbsentSection from './CandidateAbsentSection';
import { NEVER_RECORDED_COPY } from './copy';

/**
 * The append-only activity log for one candidate, newest first and bounded to 50
 * by `listAuditEventsForEntity`.
 *
 * ## A note for whoever adds the next audit payload
 *
 * `payload` is now rendered to a seller. That is safe TODAY by audit, not by
 * construction: every candidate-scoped `appendAuditEvent` caller
 * (`products/actions.ts`, `evaluate.ts`) writes shallow, credential-free
 * scalars, and `products/actions.ts` explicitly declines to copy the stock
 * attestation note into the event. Nothing structurally prevents a future writer
 * from putting a secret or a customer's personal data in there - so if you add
 * one, check it against this surface first.
 *
 * The payload sits behind a closed `Collapsible` and inside a bounded scroll box
 * rather than being dumped inline, so one large event cannot dominate the tab.
 */
export default function AuditTrailSection({
  events,
}: {
  events: AuditEventRow[];
}) {
  return (
    <DetailSection
      title={`Activity (${events.length})`}
      note={
        events.length === 0
          ? undefined
          : 'Newest first, capped at 50. Written when the candidate is evaluated or a person records a stock inspection.'
      }
    >
      {events.length === 0 ? (
        <CandidateAbsentSection
          kind="never-recorded"
          message={NEVER_RECORDED_COPY.auditEvents}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {events.map((event) => (
            <li
              key={event.id}
              className="flex flex-col gap-1 border-b border-border pb-2 last:border-b-0"
            >
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-medium">{event.action}</span>
                <span className="text-xs text-ink-subtle">
                  {formatUtcDateTime(event.createdAt)} by{' '}
                  <span className="font-mono">{event.actorId}</span>
                </span>
              </span>
              <Collapsible>
                <CollapsibleTrigger className="w-fit cursor-pointer text-xs text-ink-muted underline-offset-2 transition-colors hover:text-foreground hover:underline">
                  Show recorded detail
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-muted p-2 text-xs">
                    {JSON.stringify(event.payload, null, 2)}
                  </pre>
                </CollapsibleContent>
              </Collapsible>
            </li>
          ))}
        </ul>
      )}
    </DetailSection>
  );
}
