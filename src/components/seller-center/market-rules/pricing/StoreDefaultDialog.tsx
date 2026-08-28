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
  MAX_MARKUP_PERCENT,
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

/**
 * The reserve for one pricing scope: the markup a sale may never fall below.
 *
 * ## One number, after two
 *
 * This dialog used to carry a `Base markup over cost` beside the reserve. That
 * field was the fallback for a category with no markup of its own -- a branch
 * the resolver reaches only when `nearestCategoryPolicy === null`, which never
 * happens here because every category carries a markup. Owner decision
 * 2026-08-28: being made to set a number that never fires, in order to set the
 * one that always does, is what made this screen unreadable. It is gone, the
 * column is nullable, and the action writes null.
 *
 * ## The two reserve fields are one choice, not two
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
  const [floorPercent, setFloorPercent] = useState(
    storeDefault?.minContributionRate == null
      ? ''
      : markupPercentFromMarginRateScaled(
          parseScaledRate(storeDefault.minContributionRate),
        ).toString(),
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

  /*
    A reserve is optional -- an unset one means prices are simply not floored,
    which is a legitimate choice. Only the reason is required, so this dialog
    can also be used to clear a reserve someone no longer wants.
  */
  const ready = reason.trim().length >= MIN_REASON_CHARS;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    // Annotated, not inferred — see `SaveStoreDefaultInput`.
    const payload: SaveStoreDefaultInput = {
      // Exactly one of these carries a value. The empty string maps to "0" for
      // the amount and `null` for the rate, which is what "no floor of this
      // kind" means in the two columns respectively.
      minContribution: amountInUse ? floorAmount : '0',
      // Markup in, margin rate stored -- the same conversion the CSV importer
      // uses, so one unit reaches the seller and the other reaches the
      // resolver, and neither has to be guessed at.
      minContributionRate: percentInUse
        ? formatScaledRate(
            markupPercentToMarginRateScaled(Number(floorPercent)),
          )
        : null,
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
            The markup on a sale never drops below this, whatever the category
            says.
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

          <fieldset className="flex flex-col gap-2 rounded-md border border-border p-3">
            <legend className="px-1 text-sm font-medium">
              Never below this
            </legend>
            <p className="text-xs text-muted-foreground">
              What every sale must leave behind for your operating expenses. If
              a category would price something under this, the reserve wins. Use
              a percentage or an amount, not both.
            </p>

            <div className="flex flex-wrap items-end gap-4">
              <div className="flex flex-col gap-1.5">
                {/*
                  "Markup", named rather than left as a bare "As a percentage".
                  It is stored as a margin rate and typed as a markup over cost,
                  the same unit the category table and the import sheet use, and
                  the label is the only thing that says which — 50 means cost
                  plus half, not half the selling price.
                */}
                <Label htmlFor="store-default-floor-percent">As a markup</Label>
                <div className="flex items-center gap-1.5">
                  <Input
                    id="store-default-floor-percent"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0.01"
                    max={MAX_MARKUP_PERCENT}
                    value={floorPercent}
                    disabled={amountInUse}
                    onChange={(event) => setFloorPercent(event.target.value)}
                    aria-label={`Minimum markup percent for ${scope.label}`}
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
            actually varies along: category markup for the percentage, supplier
            cost for the amount. It runs the resolver's own functions, so it
            cannot drift from the price a product will really get.
          */}
          <StoreDefaultPreview
            floorAmount={floorAmount}
            floorPercent={floorPercent}
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
