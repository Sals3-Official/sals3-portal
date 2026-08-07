import type { ReactNode } from 'react';
import { Lock } from 'lucide-react';

type SupplierEvidenceBlockProps = {
  title?: string;
  children: ReactNode;
};

type SupplierEvidenceFieldProps = {
  label: string;
  value: string;
  /** Identifiers read better monospaced and are usually copied, not read. */
  mono?: boolean;
};

/**
 * Supplier-controlled evidence: kept exactly as it was received, and not
 * the seller's to change.
 *
 * Rendered as a read-only *surface*, never as a disabled form control. A
 * greyed-out `<input disabled>` reads as "broken" and cannot be selected
 * or copied; this stays legible, selectable and copyable, and says once
 * why it cannot be edited instead of repeating it per field.
 */
export function SupplierEvidenceField({
  label,
  value,
  mono = false,
}: SupplierEvidenceFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-ink-muted">{label}</span>
      <p
        className={`min-h-9 rounded-lg border border-dashed border-border-strong bg-background px-2.5 py-2 text-sm break-words text-ink-muted ${
          mono ? 'font-mono text-xs' : ''
        }`}
      >
        {value}
      </p>
    </div>
  );
}

export default function SupplierEvidenceBlock({
  title = 'Supplier-controlled evidence',
  children,
}: SupplierEvidenceBlockProps) {
  return (
    <div className="rounded-lg border border-border bg-background p-3.5">
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <Lock aria-hidden="true" className="size-3.5 text-muted-foreground" />
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-xs text-muted-foreground">
          — read-only, kept as it was received. Selectable and copyable.
        </span>
      </div>
      {children}
    </div>
  );
}
