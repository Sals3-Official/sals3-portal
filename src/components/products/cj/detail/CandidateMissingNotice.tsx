import { MISSING_COPY } from './copy';

/**
 * One message for "no such candidate" and "not your candidate".
 *
 * The query already returns `null` for both, indistinguishably, so that a probe
 * cannot enumerate other sellers' candidate ids. That property only holds if the
 * UI keeps it too - two different messages here would leak exactly what the
 * query refuses to.
 */
export default function CandidateMissingNotice() {
  return (
    <div
      role="note"
      className="flex flex-col gap-1 rounded-md border border-dashed border-border-strong bg-muted px-3 py-2.5"
    >
      <span className="text-sm font-medium">{MISSING_COPY.title}</span>
      <p className="text-sm text-ink-subtle">{MISSING_COPY.body}</p>
    </div>
  );
}
