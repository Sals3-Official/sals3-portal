'use client';

import { useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  DEFAULT_SCHEDULE,
  type ScheduleOption,
} from '@/lib/seller-center/mock-data/payouts';

function optionToneClass(disabled: boolean, isSelected: boolean): string {
  if (disabled) {
    return 'cursor-not-allowed border-border bg-muted/40 text-muted-foreground/70';
  }

  if (isSelected) {
    return 'cursor-pointer border-primary bg-brand-100 text-brand-900';
  }

  return 'cursor-pointer border-border bg-card text-ink-muted hover:border-primary';
}

type PayoutScheduleChooserProps = {
  options: ScheduleOption[];
  marketName: string;
};

/**
 * Payout schedule choice. Local to this browser tab only - no backend
 * exists yet to save a real preference.
 */
export default function PayoutScheduleChooser({
  options,
  marketName,
}: PayoutScheduleChooserProps) {
  const [selected, setSelected] = useState(DEFAULT_SCHEDULE);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payout schedule</CardTitle>
        <CardDescription>
          Choose what {marketName} settlement actually supports.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {options.map((option) => {
          const isSelected = option.key === selected;

          return (
            <button
              key={option.key}
              type="button"
              disabled={option.disabled}
              onClick={() => setSelected(option.key)}
              aria-pressed={isSelected}
              className={cn(
                'rounded-lg border p-3 text-left transition-colors',
                optionToneClass(option.disabled, isSelected),
              )}
            >
              <span className="block text-sm font-semibold">
                {option.label}
              </span>
              <span className="mt-1 block text-xs leading-relaxed">
                {option.note}
              </span>
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}
