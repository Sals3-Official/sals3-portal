'use client';

import { Input } from '@/components/ui/input';

type MeasurementInputControlProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
};

/**
 * A number plus an optional unit in one string, e.g. `"1.5 kg"` - shape-checked
 * server-side in `attribute-contract.ts`. No unit dropdown: the workbook
 * carries no per-category unit list for measurement controls, and inventing
 * one would be exactly the "no branch that invents a value" rule this
 * feature exists to hold.
 */
export default function MeasurementInputControl({
  id,
  value,
  onChange,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: MeasurementInputControlProps) {
  return (
    <Input
      id={id}
      value={value}
      placeholder="e.g. 1.5 kg"
      onChange={(event) => onChange(event.target.value)}
      aria-invalid={ariaInvalid}
      aria-describedby={ariaDescribedBy}
    />
  );
}
