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
import {
  decimalStringToMinor,
  formatMoney,
  minorToDecimalString,
} from '@/lib/seller-center/product-editor/format';
import type { MoneyValue } from '@/lib/seller-center/product-editor/types';

export type BulkPricingMode = 'SET_PRICE';

type BulkPricingDialogProps = {
  mode: BulkPricingMode | null;
  currency: string;
  /** How many variants the change will actually touch. */
  affectedCount: number;
  skippedCount: number;
  minimumRetailPrice: MoneyValue | null;
  onCancel: () => void;
  onApply: (amountMinor: number) => void;
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
  minimumRetailPrice,
  onApply,
}: BulkPricingFormProps) {
  const [value, setValue] = useState('');

  const copy = COPY[mode];
  const amountMinor = decimalStringToMinor(value, currency);
  const belowMinimum =
    minimumRetailPrice !== null &&
    amountMinor > 0 &&
    amountMinor < minimumRetailPrice.amountMinor;
  const isValid =
    amountMinor > 0 &&
    (minimumRetailPrice === null ||
      amountMinor >= minimumRetailPrice.amountMinor);

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
          min={
            minimumRetailPrice === null
              ? '0.01'
              : minorToDecimalString(
                  minimumRetailPrice.amountMinor,
                  minimumRetailPrice.currency,
                )
          }
          step="0.01"
          inputMode="decimal"
          value={value}
          aria-describedby="bulk-pricing-hint"
          onChange={(event) => setValue(event.target.value)}
        />
        <p id="bulk-pricing-hint" className="text-xs text-muted-foreground">
          {copy.hint}
        </p>
        {minimumRetailPrice !== null ? (
          <p className="text-xs text-muted-foreground">
            Minimum allowed: {formatMoney(minimumRetailPrice)}.
          </p>
        ) : null}
        {belowMinimum ? (
          <p className="text-xs text-destructive">
            Retail price must be at least {formatMoney(minimumRetailPrice)}.
          </p>
        ) : null}
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
          onClick={() => onApply(amountMinor)}
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
  minimumRetailPrice,
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
            minimumRetailPrice={minimumRetailPrice}
            onApply={onApply}
          />
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
