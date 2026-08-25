'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  saveCategoryPolicyAction,
  type SaveCategoryPolicyInput,
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
import type { PricingScopeDestination } from '@/modules/pricing/pricing-scope-destinations';
import DeactivateCategoryPolicyButton from './DeactivateCategoryPolicyButton';
import type {
  CategoryMarginNodeViewModel,
  EffectiveMargin,
} from './category-margin-model';

type CategoryMarginDialogProps = {
  node: CategoryMarginNodeViewModel;
  effective: EffectiveMargin;
  /**
   * The destination this edit is for.
   *
   * Passed as the whole destination rather than a bare code so the dialog can
   * name it in words. "Edit margin — Apparel & Accessories" gave no clue which
   * of six columns was clicked, and the cell that opened it is now hidden
   * behind the dialog.
   */
  destination: PricingScopeDestination;
  sellerAccountId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Called after the server confirms the write. The ROW owns what happens
   * next, not this dialog — see the note on `handleSubmit`.
   */
  onSaved: () => void;
};

function inheritedFrom(effective: EffectiveMargin): string | null {
  if (effective.source === 'ANCESTOR')
    return `Right now it follows ${effective.ancestorName}.`;
  if (effective.source === 'STORE_DEFAULT')
    return 'Right now it follows your store default.';
  if (effective.source === 'NONE') return 'Nothing prices this category today.';
  return null;
}

/**
 * The margin editor as a pop-out (owner decision, 2026-08-19), replacing the
 * inline strip that expanded inside the table.
 *
 * The inline version pushed every row below it down and, at narrow widths,
 * collided with the row underneath — the editing surface fought the table it
 * lived in. A dialog takes the edit out of the layout entirely: the table
 * never reflows, and the one category being changed is the only thing in
 * focus. The backdrop is frosted rather than a flat scrim, so the list stays
 * legible behind it as context for the change.
 *
 * This deliberately reverses the 2026-08-13 "dialog-free pricing UI" pass
 * (PR #63). That rework was right for the funding-buffer card — one field,
 * one row, nothing to displace. It does not hold for a row inside a 213-row
 * tree, where the same inline pattern is what causes the displacement.
 */
export default function CategoryMarginDialog({
  node,
  effective,
  destination,
  sellerAccountId,
  open,
  onOpenChange,
  onSaved,
}: CategoryMarginDialogProps) {
  // The rule this destination carries in its own right, which is what Save
  // revises and what Deactivate can remove. An inherited rate has no row here,
  // and offering to deactivate one would promise something this screen cannot
  // do — the rate belongs to an ancestor.
  const ownPolicy = node.policies[destination.code] ?? null;
  const [isPending, startTransition] = useTransition();
  const [marginPercent, setMarginPercent] = useState(
    ownPolicy === null
      ? ''
      : (Number(ownPolicy.targetMarginRate) * 100).toString(),
  );
  const [roundingRule, setRoundingRule] = useState<RoundingRule>(
    ownPolicy?.roundingRule ?? 'NONE',
  );
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const ready = marginPercent.trim() !== '' && reason.trim().length >= 10;
  const context = inheritedFrom(effective);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const targetMarginRate = (Number(marginPercent) / 100).toString();

    // Annotated, not inferred. This is the type that turns a missing field
    // into a build error — see `SaveCategoryPolicyInput`.
    const payload: SaveCategoryPolicyInput = {
      categoryCode: node.code,
      targetMarginRate,
      roundingRule,
      reason,
      marketCode: destination.code,
    };

    startTransition(async () => {
      const result = await saveCategoryPolicyAction(payload);

      if (!result.ok) {
        setError('Check the fields and try again.');
        return;
      }

      toast.success(`Margin saved for ${node.name} — ${destination.label}.`);
      setReason('');
      /**
       * Hand off instead of refreshing here.
       *
       * This used to call `onOpenChange(false)` and then `router.refresh()`.
       * The first line unmounts this dialog — the row renders it only while
       * open — so the refresh was dispatched from a component that was gone
       * in the same commit, and React discarded it. The save landed, the
       * toast appeared, the dialog closed, and the row still showed the old
       * rate until the seller reloaded the page by hand.
       *
       * The row survives the close, so the row does the refresh.
       */
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
            {ownPolicy === null ? 'Set margin' : 'Edit margin'} — {node.name} ·{' '}
            {destination.label}
          </DialogTitle>
          <DialogDescription>
            {node.path}
            {context === null ? '' : ` · ${context}`}
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

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="category-margin-rate">Margin</Label>
              <div className="flex items-center gap-1.5">
                <Input
                  id="category-margin-rate"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0.01"
                  max="99.99"
                  value={marginPercent}
                  onChange={(event) => setMarginPercent(event.target.value)}
                  aria-label={`Margin percent for ${node.path}`}
                  className="w-24 text-right"
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="category-margin-rounding">Rounding</Label>
              <Select
                value={roundingRule}
                onValueChange={(value) =>
                  setRoundingRule((value as RoundingRule | null) ?? 'NONE')
                }
              >
                <SelectTrigger
                  id="category-margin-rounding"
                  aria-label={`Rounding for ${node.path}`}
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
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="category-margin-reason">Reason for change</Label>
            <Input
              id="category-margin-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Reason (min 10 characters)"
              aria-label={`Reason for change to ${node.path}`}
            />
          </div>

          <p className="text-xs text-ink-faint">
            {node.subtreeCount > 0
              ? `Covers all ${node.subtreeCount.toLocaleString()} categories under ${node.name} that don't set their own margin. Categories with their own rate keep it.`
              : 'Applies to products in this category.'}
          </p>

          <div className="flex items-center justify-between gap-2">
            {/*
              Removing this destination's rule lives with the rule, not in the
              row. The row has six of them now, and a Deactivate button beside
              a row of six chips could not say which one it meant.
            */}
            <span>
              {ownPolicy === null ? null : (
                <DeactivateCategoryPolicyButton
                  policyId={ownPolicy.id}
                  sellerAccountId={sellerAccountId}
                  categoryPath={`${node.path} · ${destination.label}`}
                />
              )}
            </span>

            <span className="flex items-center gap-2">
              <DialogClose
                render={
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                }
              />
              <Button type="submit" disabled={isPending || !ready}>
                {isPending ? 'Saving…' : 'Save margin'}
              </Button>
            </span>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
