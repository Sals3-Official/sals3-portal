'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  saveStoreDefaultAction,
  type SaveStoreDefaultInput,
} from '@/app/(portal)/market-rules/pricing-actions';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { RoundingRule } from '@/modules/pricing/money-math';
import type { PricingScope } from '@/modules/pricing/pricing-scope-destinations';
import {
  formatScaledRate,
  markupPercentFromMarginRateScaled,
  markupPercentToMarginRateScaled,
  parseScaledRate,
} from '@/modules/pricing/money-math';
import StoreDefaultPreview from './StoreDefaultPreview';
import type { StoreDefaultViewModel } from './store-default-model';

type StoreDefaultDialogProps = {
  /**
   * The scope this rule is for — one of the six destinations, or Global.
   *
   * `scope.label` names it in every heading and field label; `scope.marketCode`
   * — `null` for Global — is what the write stores.
   */
  scope: PricingScope;
  storeDefault: StoreDefaultViewModel | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after the server confirms the write. The row owns what happens next. */
  onSaved: () => void;
};

const MIN_REASON_CHARS = 10;

function percentToRate(percent: string): string {
  return (Number(percent) / 100).toString();
}

function rateToPercent(rate: string): string {
  const value = Number(rate) * 100;
  const rounded = Math.round(value * 100) / 100;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(2)}`;
}

/**
 * The base margin and the floor beneath it, for one pricing scope.
 *
 * ## The two minimum fields are one choice, not two
 *
 * Owner rule 2026-08-26: the minimum a margin may never fall below is either a
 * percentage or a fixed amount, never both. Typing into one disables the other
 * here — the field is not merely ignored, it stops accepting input and says
 * why, because a form that silently drops what someone typed is how people
 * learn not to trust a screen.
 *
 * This is the first of three gates. The action's schema refuses a payload
 * carrying both, and `pricing_store_defaults_floor_exclusive` refuses the row.
 * The database one is the gate that matters: a CSV import or a hand-written
 * repair statement reaches neither of the other two.
 *
 * ## Why the percentage is offered first
 *
 * It needs no currency. The amount form is denominated in USD and the resolver
 * **refuses to price at all** when that does not match the settlement currency
 * (`CONTRIBUTION_FLOOR_CURRENCY_MISMATCH`) — safe today, when the portal is USD
 * throughout, and a live hazard the day the storefront starts settling in the
 * buyer's own currency.
 */
export default function StoreDefaultDialog({
  scope,
  storeDefault,
  open,
  onOpenChange,
  onSaved,
}: StoreDefaultDialogProps) {
  const [isPending, startTransition] = useTransition();
  const [marginPercent, setMarginPercent] = useState(
    storeDefault === null
      ? ''
      : markupPercentFromMarginRateScaled(
          parseScaledRate(storeDefault.targetMarginRate),
        ).toString(),
  );
  const [floorPercent, setFloorPercent] = useState(
    storeDefault?.minContributionRate == null
      ? ''
      : rateToPercent(storeDefault.minContributionRate),
  );
  const [floorAmount, setFloorAmount] = useState(
    storeDefault === null || storeDefault.minContributionMinor === 0
      ? ''
      : (storeDefault.minContributionMinor / 100).toFixed(2),
  );
  const [roundingRule, setRoundingRule] = useState<RoundingRule>(
    storeDefault?.roundingRule ?? 'NONE',
  );
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const amountInUse = floorAmount.trim() !== '';
  const percentInUse = floorPercent.trim() !== '';
  const ready =
    marginPercent.trim() !== '' && reason.trim().length >= MIN_REASON_CHARS;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    // Annotated, not inferred — see `SaveStoreDefaultInput`.
    const payload: SaveStoreDefaultInput = {
      // Markup in, margin rate stored — the same conversion the CSV importer
      // uses, so a rate typed here and one imported land on the same value.
      targetMarginRate: formatScaledRate(
        markupPercentToMarginRateScaled(Number(marginPercent)),
      ),
      // Exactly one of these carries a value. The empty string maps to "0" for
      // the amount and `null` for the rate, which is what "no floor of this
      // kind" means in the two columns respectively.
      minContribution: amountInUse ? floorAmount : '0',
      minContributionRate: percentInUse ? percentToRate(floorPercent) : null,
      roundingRule,
      marketCode: scope.marketCode,
      reason,
    };

    startTransition(async () => {
      const result = await saveStoreDefaultAction(payload);

      if (!result.ok) {
        setError(
          'fieldErrors' in result && result.fieldErrors !== undefined
            ? (Object.values(result.fieldErrors)[0] ??
                'Check the fields and try again.')
            : 'Check the fields and try again.',
        );
        return;
      }

      toast.success(`Store default saved for ${scope.label}.`);
      setReason('');
      onSaved();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        overlayClassName="bg-foreground/15 supports-backdrop-filter:backdrop-blur-md"
      >
        <DialogHeader>
          <DialogTitle>
            {storeDefault === null ? 'Set store default' : 'Edit store default'}{' '}
            — {scope.label}
          </DialogTitle>
          <DialogDescription>
            Covers every category with no markup of its own and no priced
            parent.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit}
          noValidate
          className="flex flex-col gap-4"
        >
          {error === null ? null : (
            <p
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="store-default-margin">Base markup over cost</Label>
            <div className="flex items-center gap-1.5">
              <Input
                id="store-default-margin"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.01"
                max="99.99"
                value={marginPercent}
                onChange={(event) => setMarginPercent(event.target.value)}
                aria-label={`Base markup percent for ${scope.label}`}
                className="w-24 text-right"
              />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
          </div>

          <fieldset className="flex flex-col gap-2 rounded-md border border-border p-3">
            <legend className="px-1 text-sm font-medium">
              Minimum — never price below this
            </legend>
            <p className="text-xs text-muted-foreground">
              Your operating expenses. Use a percentage or an amount, not both.
            </p>

            <div className="flex flex-wrap items-end gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="store-default-floor-percent">
                  As a percentage
                </Label>
                <div className="flex items-center gap-1.5">
                  <Input
                    id="store-default-floor-percent"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0.01"
                    max="99.99"
                    value={floorPercent}
                    disabled={amountInUse}
                    onChange={(event) => setFloorPercent(event.target.value)}
                    aria-label={`Minimum margin percent for ${scope.label}`}
                    className="w-24 text-right"
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="store-default-floor-amount">As an amount</Label>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm text-muted-foreground">US$</span>
                  <Input
                    id="store-default-floor-amount"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    value={floorAmount}
                    disabled={percentInUse}
                    onChange={(event) => setFloorAmount(event.target.value)}
                    aria-label={`Minimum contribution amount for ${scope.label}`}
                    className="w-28 text-right"
                  />
                </div>
              </div>
            </div>

            {amountInUse || percentInUse ? (
              <p className="text-xs text-ink-faint">
                {amountInUse
                  ? 'Clear the amount to use a percentage instead.'
                  : 'Clear the percentage to use an amount instead.'}
              </p>
            ) : null}
          </fieldset>

          {/*
            The rule shown rather than described, and on the axis each form
            actually varies along: supplier cost for the amount, category margin
            for the percentage. It runs the resolver's own functions, so it
            cannot drift from the price a product will really get.
          */}
          <StoreDefaultPreview
            marginPercent={marginPercent}
            floorAmount={floorAmount}
            floorPercent={floorPercent}
            roundingRule={roundingRule}
          />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="store-default-rounding">Rounding</Label>
            <Select
              value={roundingRule}
              onValueChange={(value) =>
                setRoundingRule((value as RoundingRule | null) ?? 'NONE')
              }
            >
              <SelectTrigger
                id="store-default-rounding"
                aria-label={`Rounding for ${scope.label}`}
                className="w-48"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">None — exact price</SelectItem>
                <SelectItem value="NEAREST_0_99">Nearest .99</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="store-default-reason">Reason for change</Label>
            <Input
              id="store-default-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={`Reason (min ${MIN_REASON_CHARS} characters)`}
              aria-label={`Reason for change to ${scope.label}`}
            />
          </div>

          <div className="flex items-center justify-end gap-2">
            <DialogClose
              render={
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              }
            />
            <Button type="submit" disabled={isPending || !ready}>
              {isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
