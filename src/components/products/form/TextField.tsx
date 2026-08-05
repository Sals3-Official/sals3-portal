import { Input } from '@/components/ui/input';
import FieldShell from './FieldShell';

type TextFieldProps = {
  name: string;
  label: string;
  defaultValue?: string;
  hint?: string;
  errors?: string[];
  required?: boolean;
  type?: 'text' | 'number' | 'date' | 'url';
  inputMode?: 'text' | 'numeric' | 'decimal';
  placeholder?: string;
  min?: number;
  step?: string;
};

/** Single-line field. The `name` doubles as the id and the error key. */
export default function TextField({
  name,
  label,
  defaultValue = '',
  hint,
  errors,
  required = false,
  type = 'text',
  inputMode,
  placeholder,
  min,
  step,
}: TextFieldProps) {
  const hasError = errors !== undefined && errors.length > 0;

  return (
    <FieldShell
      id={name}
      label={label}
      hint={hint}
      errors={errors}
      required={required}
    >
      <Input
        id={name}
        name={name}
        type={type}
        inputMode={inputMode}
        defaultValue={defaultValue}
        placeholder={placeholder}
        min={min}
        step={step}
        required={required}
        aria-invalid={hasError}
        aria-describedby={
          [
            hint === undefined ? null : `${name}-hint`,
            hasError ? `${name}-error` : null,
          ]
            .filter((value) => value !== null)
            .join(' ') || undefined
        }
        className="bg-card"
      />
    </FieldShell>
  );
}
