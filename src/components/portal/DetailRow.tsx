import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type DetailRowProps = {
  label: string;
  /** A node, not a string, so a row can hold a pill, a link, or a list. */
  value: ReactNode;
  /** Opaque ids, checksums, and fingerprints - anything read character by character. */
  mono?: boolean;
  /**
   * A caveat that must travel WITH the value, never as a distant footnote.
   * `estimatedMarginPercent` is not a real margin and `listedCount` is not
   * units sold; a reader who sees the number without the caveat has been
   * misled, so the two are rendered in the same row.
   */
  hint?: string;
};

/**
 * One label/value pair in a read-only detail surface.
 *
 * Extracted because three near-identical local versions already existed
 * (`SupplierSourceDrawer`'s `DrawerRow`, `SupplierSourceDetailsPanel`'s
 * `Field`, and an inline `<dl>` in `CandidateEvidencePanel`). Renders a
 * `<dt>`/`<dd>` pair, so every caller must place it inside a `<dl>`.
 *
 * Type scale per `design-system/sals3-portal/MASTER.md` §3: label at metadata
 * size (12px/500), value at body size (14px/400). Nothing below 12px.
 */
export default function DetailRow({
  label,
  value,
  mono = false,
  hint,
}: DetailRowProps) {
  return (
    <div className="grid gap-1 border-b border-border py-2 last:border-b-0 sm:grid-cols-[11rem_1fr] sm:gap-3">
      <dt className="text-xs font-medium text-ink-muted">{label}</dt>
      <dd className="m-0 text-sm break-words">
        <span className={cn(mono && 'font-mono text-xs')}>{value}</span>
        {hint === undefined ? null : (
          <span className="mt-0.5 block text-xs text-ink-subtle">{hint}</span>
        )}
      </dd>
    </div>
  );
}
