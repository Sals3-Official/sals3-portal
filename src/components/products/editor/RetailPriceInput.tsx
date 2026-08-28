'use client';

import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
  /**
   * Whether this cell is open for typing.
   *
   * `false` renders the number as text beside a pencil. The margin rules are
   * the source of a price; typing over one is a deliberate act, and a field a
   * cursor lands in by accident is not deliberate.
   */
  unlocked: boolean;
  /** Asks the workspace to unlock this variant — it collects the reason. */
  onRequestUnlock: () => void;
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
 * ## Locked until somebody says why
 *
 * The cell renders as text with a pencil until the seller unlocks it. Owner
 * decision 2026-08-28: the margin rules are where a price comes from, and
 * overriding one is a business decision that should be recorded — so the
 * workspace collects a reason on unlock and `save-draft.ts` writes a
 * `product_offer.retail_price_overridden` audit event naming the actor, the old
 * price and the new one.
 *
 * This is a guard against the accidental edit, not an authorization check. A
 * disabled control never is one: the value still reaches the server through a
 * Server Action, which re-derives what it stores either way.
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
  unlocked,
  onRequestUnlock,
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

  /*
    Locked is the default, and it is a presentation state only: `publish.ts` and
    the draft save both re-derive what they will store, so a disabled control is
    never what stops an unwanted price. It stops an *accidental* one, which is
    the actual failure the owner reported.
  */
  if (!unlocked) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="tabular-nums" aria-label={label}>
          {formatMoney(value)}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Override ${label}`}
          onClick={onRequestUnlock}
        >
          <Pencil aria-hidden="true" className="size-3.5" />
        </Button>
      </div>
    );
  }

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
