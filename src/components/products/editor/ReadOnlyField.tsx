type ReadOnlyFieldProps = {
  /** Omit when the caller renders its own label/badge row above this. */
  label?: string;
  value: string;
  /** Identifiers read better monospaced and are usually copied, not read. */
  mono?: boolean;
  id?: string;
  ariaLabelledBy?: string;
  ariaInvalid?: true;
  ariaDescribedBy?: string;
};

/**
 * A supplier fact or curated decision: kept exactly as it was received, and
 * not the seller's to change.
 *
 * Rendered as a read-only *surface*, never as a disabled form control. A
 * greyed-out `<input disabled>` reads as "broken" and cannot be selected
 * or copied; this stays legible, selectable and copyable, and says once
 * why it cannot be edited instead of repeating it per field.
 */
export default function ReadOnlyField({
  label,
  value,
  mono = false,
  id,
  ariaLabelledBy,
  ariaInvalid,
  ariaDescribedBy,
}: ReadOnlyFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {label === undefined ? null : (
        <span className="text-xs font-semibold text-ink-muted">{label}</span>
      )}
      <p
        id={id}
        aria-labelledby={ariaLabelledBy}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        className={`min-h-9 rounded-lg border border-dashed border-border-strong bg-background px-2.5 py-2 text-sm break-words text-ink-muted ${
          mono ? 'font-mono text-xs' : ''
        }`}
      >
        {value}
      </p>
    </div>
  );
}
