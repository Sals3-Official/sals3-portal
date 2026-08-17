'use client';

import { Input } from '@/components/ui/input';

type DatePickerControlProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
};

export default function DatePickerControl({
  id,
  value,
  onChange,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: DatePickerControlProps) {
  return (
    <Input
      id={id}
      type="date"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-invalid={ariaInvalid}
      aria-describedby={ariaDescribedBy}
    />
  );
}
