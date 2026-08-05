import { Textarea } from '@/components/ui/textarea';
import FieldShell from './FieldShell';

type TextareaFieldProps = {
  name: string;
  label: string;
  defaultValue?: string;
  hint?: string;
  errors?: string[];
  required?: boolean;
  rows?: number;
  maxLength?: number;
};

/** Multi-line field for the description and the meta description. */
export default function TextareaField({
  name,
  label,
  defaultValue = '',
  hint,
  errors,
  required = false,
  rows = 5,
  maxLength,
}: TextareaFieldProps) {
  const hasError = errors !== undefined && errors.length > 0;

  return (
    <FieldShell
      id={name}
      label={label}
      hint={hint}
      errors={errors}
      required={required}
    >
      <Textarea
        id={name}
        name={name}
        rows={rows}
        maxLength={maxLength}
        defaultValue={defaultValue}
        required={required}
        aria-invalid={hasError}
        className="min-h-24 bg-card"
      />
    </FieldShell>
  );
}
