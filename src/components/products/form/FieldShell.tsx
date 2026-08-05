import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';

type FieldShellProps = {
  id: string;
  label: string;
  hint?: string;
  errors?: string[];
  required?: boolean;
  children: ReactNode;
};

/**
 * Field wrapper. Every field gets a visible label, optional helper text, and
 * its error message directly below the input - never a placeholder used as a
 * label, and never errors collected only at the top of the form.
 */
export default function FieldShell({
  id,
  label,
  hint,
  errors,
  required = false,
  children,
}: FieldShellProps) {
  const hasError = errors !== undefined && errors.length > 0;

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-sm font-medium">
        {/* One child, so the label's flex gap cannot separate the asterisk
            from the last word of the label. */}
        <span>
          {label}
          {required ? (
            <span aria-hidden="true" className="pl-0.5 text-destructive">
              *
            </span>
          ) : null}
        </span>
      </Label>
      {children}
      {hint === undefined ? null : (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {hasError ? (
        <p id={`${id}-error`} className="text-xs font-medium text-destructive">
          {errors[0]}
        </p>
      ) : null}
    </div>
  );
}
