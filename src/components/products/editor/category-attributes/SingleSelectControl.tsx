'use client';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const CUSTOM_VALUE_OPTION = '__custom__';

type SingleSelectControlProps = {
  id: string;
  values: readonly string[];
  allowedValues: readonly string[];
  allowCustomValue: boolean;
  isCustomValue: boolean;
  onChange: (values: string[], isCustomValue: boolean) => void;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
};

/** A dropdown value outside `allowedValues` only ever means a stored custom value - never an unrecognised one, since the server preserves anything it doesn't recognise separately. */
export default function SingleSelectControl({
  id,
  values,
  allowedValues,
  allowCustomValue,
  isCustomValue,
  onChange,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: SingleSelectControlProps) {
  const current = values[0] ?? '';
  const showingCustomInput =
    allowCustomValue &&
    (isCustomValue || (current !== '' && !allowedValues.includes(current)));

  return (
    <div className="flex flex-col gap-1.5">
      <Select
        value={showingCustomInput ? CUSTOM_VALUE_OPTION : current}
        onValueChange={(next) => {
          if (next === null) {
            onChange([], false);
            return;
          }

          if (next === CUSTOM_VALUE_OPTION) {
            onChange([''], true);
            return;
          }

          onChange([next], false);
        }}
      >
        <SelectTrigger
          id={id}
          className="w-full"
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
        >
          <SelectValue placeholder="Select a value" />
        </SelectTrigger>
        <SelectContent>
          {allowedValues.map((value) => (
            <SelectItem key={value} value={value}>
              {value}
            </SelectItem>
          ))}
          {allowCustomValue ? (
            <SelectItem value={CUSTOM_VALUE_OPTION}>
              Other (type your own)
            </SelectItem>
          ) : null}
        </SelectContent>
      </Select>
      {showingCustomInput ? (
        <Input
          value={current}
          placeholder="Enter a value"
          onChange={(event) => onChange([event.target.value], true)}
        />
      ) : null}
    </div>
  );
}
