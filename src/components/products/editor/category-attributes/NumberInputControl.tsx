'use client';

import { Input } from '@/components/ui/input';

type NumberInputControlProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
};

/** A plain number string, e.g. `"12.5"` - shape-checked server-side in `attribute-contract.ts`. */
export default function NumberInputControl({
  id,
  value,
  onChange,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: NumberInputControlProps) {
  return (
    <Input
      id={id}
      type="number"
      inputMode="decimal"
      value={value}
      placeholder="Enter a number"
      onChange={(event) => onChange(event.target.value)}
      aria-invalid={ariaInvalid}
      aria-describedby={ariaDescribedBy}
    />
  );
}
