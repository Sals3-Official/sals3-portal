'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type MultiSelectChipsControlProps = {
  id: string;
  values: readonly string[];
  allowedValues: readonly string[];
  allowCustomValue: boolean;
  onChange: (values: string[], isCustomValue: boolean) => void;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
};

/**
 * Checkbox list rather than a searchable combobox: every source category's
 * `Allowed Values` list is short (single digits to low tens), so a scrollable
 * checklist reads faster than a search box with nothing to filter yet.
 */
export default function MultiSelectChipsControl({
  id,
  values,
  allowedValues,
  allowCustomValue,
  onChange,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: MultiSelectChipsControlProps) {
  const [customDraft, setCustomDraft] = useState('');
  const selected = new Set(values);
  const customValues = values.filter((value) => !allowedValues.includes(value));

  function toggle(value: string) {
    const next = selected.has(value)
      ? values.filter((existing) => existing !== value)
      : [...values, value];
    const hasCustom = next.some((entry) => !allowedValues.includes(entry));

    onChange(next, hasCustom);
  }

  function removeCustom(value: string) {
    const next = values.filter((existing) => existing !== value);
    const hasCustom = next.some((entry) => !allowedValues.includes(entry));

    onChange(next, hasCustom);
  }

  function addCustom() {
    const trimmed = customDraft.trim();

    if (trimmed === '' || values.includes(trimmed)) return;

    onChange([...values, trimmed], true);
    setCustomDraft('');
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        id={id}
        className="flex max-h-40 flex-col gap-2 overflow-y-auto rounded-lg border border-input p-2"
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
      >
        {allowedValues.map((value) => {
          const checkboxId = `${id}-${value}`;

          return (
            <div key={value} className="flex items-center gap-2">
              <Checkbox
                id={checkboxId}
                checked={selected.has(value)}
                onCheckedChange={() => toggle(value)}
              />
              <Label htmlFor={checkboxId} className="font-normal">
                {value}
              </Label>
            </div>
          );
        })}
      </div>
      {customValues.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {customValues.map((value) => (
            <span
              key={value}
              className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-xs text-brand-900"
            >
              {value}
              <button
                type="button"
                aria-label={`Remove ${value}`}
                className="text-ink-muted hover:text-ink"
                onClick={() => removeCustom(value)}
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {allowCustomValue ? (
        <div className="flex gap-2">
          <Input
            value={customDraft}
            placeholder="Add a custom value"
            onChange={(event) => setCustomDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              addCustom();
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => addCustom()}
          >
            Add
          </Button>
        </div>
      ) : null}
    </div>
  );
}
