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

export type BulkPricingMode = 'SET_PRICE';

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
    hint: 'Retail price is the only seller-entered price field on this screen.',
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
  const [value, setValue] = useState('');

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
          {copy.label} ({currency})
        </Label>
        <Input
          id="bulk-pricing-value"
          type="number"
          min="0"
          step="0.01"
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
            : ` Skips ${skippedCount} that cannot be priced - blocked or paused.`}
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
