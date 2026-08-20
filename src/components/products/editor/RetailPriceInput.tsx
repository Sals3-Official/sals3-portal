'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import {
  decimalStringToMinor,
  formatMoney,
  minorToDecimalString,
} from '@/lib/seller-center/product-editor/format';
import { minimumRetailAmountMinorForSupplierCost } from '@/lib/pricing/retail-price-floor';
import type { MoneyValue } from '@/lib/seller-center/product-editor/types';

type RetailPriceInputProps = {
  label: string;
  value: MoneyValue;
  /** The supplier's cost, for the floor the server enforces at publish. */
  supplierCost: MoneyValue;
  onChange: (amountMinor: number) => void;
};

/**
 * The retail price cell — a free-typing money field with the supplier-cost floor
 * shown before publish refuses it.
 *
 * ## Why this exists rather than a plain controlled `Input`
 *
 * The previous cell was fully controlled on derived state:
 * `value={minorToDecimalString(amountMinor)}` with
 * `onChange={decimalStringToMinor(...)}`. Every keystroke round-tripped through
 * minor units and came back re-formatted, so typing `12` rendered `1.00` and put
 * the caret after it — the next digit landed in the wrong place. In practice the
 * only reliable way to move the number was the spinner arrows.
 *
 * So the visible string is now local state. It is seeded from the prop and synced
 * back only when the field is **not focused**, which is the one condition under
 * which reformatting cannot fight the person typing. `onChange` still fires per
 * keystroke, so the parent stays live and nothing needs a save-on-blur.
 *
 * `type="text"` with `inputMode="decimal"` rather than `type="number"`: a number
 * input silently discards intermediate states like `4.` and `.5`, which is the
 * other half of why the field felt stuck.
 *
 * ## The floor is advisory here and authoritative on the server
 *
 * This shows the seller the problem while they are still in the field. The
 * workspace also clamps editor state, and `publish.ts` refuses
 * `RETAIL_BELOW_SUPPLIER_COST` with the same comparison, because a disabled
 * control is never an authorization check and this value reaches the server
 * through a Server Action either way.
 */
export default function RetailPriceInput({
  label,
  value,
  supplierCost,
  onChange,
}: RetailPriceInputProps) {
  const formatted = minorToDecimalString(value.amountMinor, value.currency);
  const [draft, setDraft] = useState(formatted);
  const [syncedFrom, setSyncedFrom] = useState(formatted);
  const [focused, setFocused] = useState(false);

  // Pull external changes in — a bulk price action, or a reset to supplier
  // content — but never while the field has focus, or the caret jumps mid-word.
  //
  // Adjusted during render rather than in an effect. That is React's documented
  // pattern for "reset state when a prop changes": it avoids the extra paint an
  // effect would cause, and an effect here trips `react-hooks/set-state-in-effect`
  // for exactly that reason.
  if (formatted !== syncedFrom) {
    setSyncedFrom(formatted);

    if (!focused) setDraft(formatted);
  }

  const comparable = value.currency === supplierCost.currency;
  const minimumAmountMinor = minimumRetailAmountMinorForSupplierCost(
    supplierCost.amountMinor,
  );
  const minimumRetailPrice = {
    amountMinor: minimumAmountMinor,
    currency: supplierCost.currency,
  };
  const draftAmountMinor = decimalStringToMinor(draft, value.currency);
  const belowFloor =
    comparable &&
    ((value.amountMinor > 0 && value.amountMinor < minimumAmountMinor) ||
      (draftAmountMinor > 0 && draftAmountMinor < minimumAmountMinor));
  const errorId = belowFloor ? `${label}-below-floor` : undefined;

  return (
    <div className="flex flex-col gap-1">
      <Input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        aria-label={label}
        aria-invalid={belowFloor}
        aria-describedby={errorId}
        className={`h-8 w-24 tabular-nums ${
          belowFloor ? 'border-destructive text-destructive' : ''
        }`}
        value={draft}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          // Tidy the string only once the person has left the field.
          const tidy = minorToDecimalString(value.amountMinor, value.currency);

          setSyncedFrom(tidy);
          setDraft(tidy);
        }}
        onChange={(event) => {
          const next = event.target.value;

          setDraft(next);
          onChange(decimalStringToMinor(next, value.currency));
        }}
      />
      {belowFloor ? (
        <span id={errorId} className="text-xs text-destructive">
          Minimum {formatMoney(minimumRetailPrice)}
        </span>
      ) : null}
    </div>
  );
}
