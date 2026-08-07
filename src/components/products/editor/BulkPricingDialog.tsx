'use client';

import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export type BulkPricingMode = 'SET_PRICE' | 'APPLY_MARKUP';

type BulkPricingDialogProps = {
  mode: BulkPricingMode | null;
  currency: string;
  /** How many variants the change will actually touch. */
  affectedCount: number;
  skippedCount: number;
  onCancel: () => void;
  onApply: (value: number) => void;
};

const COPY: Record<
  BulkPricingMode,
  { title: string; description: string; label: string; hint: string }
> = {
  SET_PRICE: {
    title: 'Set retail price',
    description:
      'Sets the same retail price on every variant that will be listed.',
    label: 'Retail price',
    hint: 'Applied as-is. Margin is recalculated from each variant’s own supplier cost and freight estimate.',
  },
  APPLY_MARKUP: {
    title: 'Apply markup',
    description:
      'Sets each retail price to its own landed cost plus this markup.',
    label: 'Markup percentage',
    hint: 'A variant with no route evidence has no landed cost, so it is skipped rather than priced from a guess.',
  },
};

/**
 * The two bulk pricing actions, sharing one dialog.
 *
 * Both state their blast radius before they run - how many variants they
 * will change and how many they will skip. A bulk action that silently
 * touched a blocked, paused or unroutable variant is the failure mode this
 * is guarding against; the count makes the skip visible up front rather
 * than leaving the seller to notice afterwards.
 */
type BulkPricingFormProps = Omit<
  BulkPricingDialogProps,
  'mode' | 'onCancel'
> & {
  mode: BulkPricingMode;
};

/**
 * Mounted with `key={mode}`, so switching action gets a fresh field with
 * the right default instead of an effect resetting state after the fact.
 */
function BulkPricingForm({
  mode,
  currency,
  affectedCount,
  skippedCount,
  onApply,
}: BulkPricingFormProps) {
  const [value, setValue] = useState(mode === 'APPLY_MARKUP' ? '40' : '');

  const copy = COPY[mode];
  const parsed = Number.parseFloat(value);
  const isValid = !Number.isNaN(parsed) && parsed > 0;

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>{copy.title}</AlertDialogTitle>
        <AlertDialogDescription>{copy.description}</AlertDialogDescription>
      </AlertDialogHeader>

      <div className="flex flex-col gap-1.5 px-4">
        <Label htmlFor="bulk-pricing-value">
          {copy.label}
          {mode === 'SET_PRICE' ? ` (${currency})` : ' (%)'}
        </Label>
        <Input
          id="bulk-pricing-value"
          type="number"
          min="0"
          step={mode === 'SET_PRICE' ? '0.01' : '1'}
          inputMode="decimal"
          value={value}
          aria-describedby="bulk-pricing-hint"
          onChange={(event) => setValue(event.target.value)}
        />
        <p id="bulk-pricing-hint" className="text-xs text-muted-foreground">
          {copy.hint}
        </p>
        <p className="text-xs text-muted-foreground">
          Changes {affectedCount} {affectedCount === 1 ? 'variant' : 'variants'}
          .
          {skippedCount === 0
            ? ''
            : ` Skips ${skippedCount} that cannot be priced - blocked, paused, or without route evidence.`}
        </p>
      </div>

      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction
          disabled={!isValid || affectedCount === 0}
          onClick={() => onApply(parsed)}
        >
          Apply
        </AlertDialogAction>
      </AlertDialogFooter>
    </>
  );
}

export default function BulkPricingDialog({
  mode,
  currency,
  affectedCount,
  skippedCount,
  onCancel,
  onApply,
}: BulkPricingDialogProps) {
  return (
    <AlertDialog
      open={mode !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialogContent>
        {mode === null ? null : (
          <BulkPricingForm
            key={mode}
            mode={mode}
            currency={currency}
            affectedCount={affectedCount}
            skippedCount={skippedCount}
            onApply={onApply}
          />
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
