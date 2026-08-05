import FieldShell from './FieldShell';

type SelectFieldProps = {
  name: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  defaultValue?: string;
  hint?: string;
  errors?: string[];
};

/**
 * A native `<select>` on purpose.
 *
 * Inside a form the platform control submits reliably with no client
 * JavaScript, opens the native picker on a phone, and is keyboard accessible
 * without extra code. The styled shadcn/ui `Select` is used for the URL-backed
 * list filters, where the control drives navigation instead of a form field.
 */
export default function SelectField({
  name,
  label,
  options,
  defaultValue,
  hint,
  errors,
}: SelectFieldProps) {
  const hasError = errors !== undefined && errors.length > 0;

  return (
    <FieldShell id={name} label={label} hint={hint} errors={errors} required>
      <select
        id={name}
        name={name}
        defaultValue={defaultValue}
        aria-invalid={hasError}
        className="h-9 w-full cursor-pointer rounded-lg border border-input bg-card px-2.5 text-sm transition-colors duration-150 focus-visible:border-ring"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}
