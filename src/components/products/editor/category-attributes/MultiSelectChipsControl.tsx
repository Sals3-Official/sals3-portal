'use client';

import { useState } from 'react';
import { ChevronDownIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

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
 * Closed-by-default dropdown, same trigger footprint (height, border, radius)
 * as `SingleSelectControl`'s `Select` - owner feedback 2026-08-17 was that an
 * always-expanded checklist read as a different, inconsistent control next
 * to every single-select field on the same Specification grid. The popup
 * itself stays a checkbox list rather than a searchable combobox: every
 * source category's `Allowed Values` list is short (5-10 entries across the
 * extracted workbook), so a checklist reads faster than a search box with
 * nothing to filter yet.
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

  const summary = values.length === 0 ? 'Select values' : values.join(', ');

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            id={id}
            aria-describedby={ariaDescribedBy}
            className={cn(
              'flex h-8 w-full items-center justify-between gap-1.5 rounded-lg border bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 dark:hover:bg-input/50',
              ariaInvalid
                ? 'border-destructive ring-3 ring-destructive/20 dark:border-destructive/50 dark:ring-destructive/40'
                : 'border-input focus-visible:border-ring',
            )}
          >
            <span
              className={cn(
                'line-clamp-1 text-left',
                values.length === 0 && 'text-muted-foreground',
              )}
            >
              {summary}
            </span>
            <ChevronDownIcon
              aria-hidden="true"
              className="pointer-events-none size-4 shrink-0 text-muted-foreground"
            />
          </button>
        }
      />
      <PopoverContent align="start" className="w-72">
        <div className="flex max-h-52 flex-col gap-2 overflow-y-auto">
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
          <div className="mt-2 flex flex-wrap gap-1.5">
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
          <div className="mt-2 flex gap-2">
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
      </PopoverContent>
    </Popover>
  );
}
