'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { saveFxAdjustmentPolicyAction } from '@/app/(portal)/market-rules/pricing-actions';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Textarea } from '@/components/ui/textarea';
import type { PricingFxAdjustmentPolicyRow } from '@/lib/db/schema';

const FUNDING_RAIL_LABELS: Record<string, string> = {
  CJ_WALLET_WIRE_TRANSFER: 'CJ Wallet — wire transfer top-up',
  CJ_WALLET_PAYONEER: 'CJ Wallet — Payoneer top-up',
  OTHER: 'Other',
};

type FxAdjustmentFormDialogProps = {
  mode: 'create' | 'edit';
  /** Present when, and only when, `mode === 'edit'`. */
  existing?: PricingFxAdjustmentPolicyRow;
};

/**
 * Seller-owned FX adjustment (ADR-015 §4) — a signed buffer for the
 * seller's own funding/conversion exposure, scoped by currency pair and
 * funding rail. Deliberately separate from category margin: this dialog
 * never touches `targetMarginRate`.
 */
export default function FxAdjustmentFormDialog({
  mode,
  existing,
}: FxAdjustmentFormDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [sourceCurrency, setSourceCurrency] = useState(
    existing?.sourceCurrency ?? 'USD',
  );
  const [targetCurrency, setTargetCurrency] = useState(
    existing?.targetCurrency ?? 'AUD',
  );
  const [fundingRail, setFundingRail] = useState(
    existing?.fundingRail ?? 'CJ_WALLET_WIRE_TRANSFER',
  );
  const [adjustmentPercent, setAdjustmentPercent] = useState(
    existing === undefined
      ? ''
      : (Number(existing.adjustmentRate) * 100).toString(),
  );
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();
  const isEditing = mode === 'edit';

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const adjustmentRate = (Number(adjustmentPercent) / 100).toString();

    startTransition(async () => {
      const result = await saveFxAdjustmentPolicyAction({
        sourceCurrency,
        targetCurrency,
        fundingRail,
        adjustmentRate,
        reason,
      });

      if (!result.ok) {
        setError('Check the highlighted fields and try again.');
        return;
      }

      toast.success(
        isEditing ? 'FX adjustment updated.' : 'FX adjustment created.',
      );
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant={isEditing ? 'outline' : 'default'}
            size="sm"
          >
            {isEditing ? 'Edit' : 'Add FX adjustment'}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Edit FX adjustment' : 'Add FX adjustment'}
          </DialogTitle>
          <DialogDescription>
            A signed buffer on top of the platform reference rate, for your own
            funding/conversion exposure on this currency pair and rail. This is
            separate from category margin.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit} noValidate>
          {error === null ? null : (
            <p
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-source`}>Source currency</Label>
              <Input
                id={`${fieldId}-source`}
                value={sourceCurrency}
                onChange={(event) =>
                  setSourceCurrency(event.target.value.toUpperCase())
                }
                maxLength={3}
                required
                disabled={isEditing}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-target`}>Target currency</Label>
              <Input
                id={`${fieldId}-target`}
                value={targetCurrency}
                onChange={(event) =>
                  setTargetCurrency(event.target.value.toUpperCase())
                }
                maxLength={3}
                required
                disabled={isEditing}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-rail`}>Funding rail</Label>
            <Select
              value={fundingRail}
              onValueChange={(value) => setFundingRail(value ?? 'OTHER')}
              disabled={isEditing}
            >
              <SelectTrigger id={`${fieldId}-rail`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(FUNDING_RAIL_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-adjustment`}>
              Adjustment (%, can be negative)
            </Label>
            <Input
              id={`${fieldId}-adjustment`}
              type="number"
              min="-20"
              max="20"
              step="0.01"
              inputMode="decimal"
              required
              value={adjustmentPercent}
              onChange={(event) => setAdjustmentPercent(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-reason`}>Reason</Label>
            <Textarea
              id={`${fieldId}-reason`}
              required
              minLength={10}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="What real funding/conversion exposure does this cover?"
            />
          </div>
          <DialogFooter>
            <DialogClose
              render={
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              }
            />
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
