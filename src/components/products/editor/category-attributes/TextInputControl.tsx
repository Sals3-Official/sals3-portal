'use client';

import { Input } from '@/components/ui/input';

type TextInputControlProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
};

export default function TextInputControl({
  id,
  value,
  onChange,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: TextInputControlProps) {
  return (
    <Input
      id={id}
      value={value}
      placeholder="Enter a value"
      onChange={(event) => onChange(event.target.value)}
      aria-invalid={ariaInvalid}
      aria-describedby={ariaDescribedBy}
    />
  );
}
