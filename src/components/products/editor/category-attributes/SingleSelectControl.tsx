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
  /**
   * Maps a raw allowed value to what a seller/buyer reads for it (e.g. the
   * workbook's `UNBRANDED` token displaying as `Generic`). The submitted
   * `value` is always the raw token underneath — this only ever changes the
   * rendered label. Defaults to the identity mapping.
   */
  getDisplayLabel?: (value: string) => string;
  /**
   * Shown while nothing is selected. A buyer-facing display default (e.g.
   * `Generic`/`Others`) belongs here rather than in `allowedValues`, so it
   * never looks like an actual, submittable selection.
   */
  placeholder?: string;
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
  getDisplayLabel = (value) => value,
  placeholder = 'Select a value',
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: SingleSelectControlProps) {
  const current = values[0] ?? '';
  const showingCustomInput =
    allowCustomValue &&
    (isCustomValue || (current !== '' && !allowedValues.includes(current)));
  /**
   * In custom mode there is no `allowedValues` entry to map through
   * `getDisplayLabel` - the seller's raw typed text is shown as-is, same as
   * the `Input` right below it.
   */
  let triggerLabel = placeholder;

  if (current !== '') {
    triggerLabel = showingCustomInput ? current : getDisplayLabel(current);
  }

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
          {/*
            A children render-function, not the `placeholder` prop: base-ui's
            `Select.Value` renders the raw selected value verbatim unless a
            function is supplied to format it, and a `children` function
            (once given) is what takes over the empty/placeholder case too -
            see `SelectValue.d.ts`.
            Renders `triggerLabel`, computed from `current`/`showingCustomInput`,
            instead of the function's own `value` argument - which, while a
            custom value is showing, is the Select's own *controlled* value,
            permanently the literal `__custom__` token, so the "Other" list
            item stays highlighted. Rendering that argument verbatim was the
            bug: the trigger showed the sentinel string itself instead of
            what was typed.
          */}
          <SelectValue>{() => triggerLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {allowedValues.map((value) => (
            <SelectItem key={value} value={value}>
              {getDisplayLabel(value)}
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
