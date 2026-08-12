'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  getFundingBufferHistoryAction,
  saveFundingBufferPolicyAction,
} from '@/app/(portal)/market-rules/pricing-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import DisclosureBanner from '@/components/seller-center/shared/DisclosureBanner';
import type { PricingFxAdjustmentPolicyRow } from '@/lib/db/schema';
import DeactivateFundingBufferButton from './DeactivateFundingBufferButton';
import PolicyHistoryButton from './PolicyHistoryButton';

type FundingBufferCardProps = {
  policy: PricingFxAdjustmentPolicyRow | null;
  sellerAccountId: string;
  canManage: boolean;
};

function saveButtonLabel(isPending: boolean, hasPolicy: boolean): string {
  if (isPending) return 'Saving…';
  return hasPolicy ? 'Save' : 'Set a buffer';
}

function formatSignedPercent(rate: string): string {
  const value = Number(rate) * 100;
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

/**
 * The seller's single funding buffer (ADR-015 §4) — a flat cost-basis
 * uplift covering the real cost of converting the seller's own funding
 * currency (e.g. AUD) to top up a supplier wallet (e.g. CJ Wallet, which
 * only accepts USD/EUR). One card, not a table: at most one active buffer
 * exists per seller. Editing is always inline — no dialog, matching the
 * category-pricing redesign's own rule.
 */
export default function FundingBufferCard({
  policy,
  sellerAccountId,
  canManage,
}: FundingBufferCardProps) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [adjustmentPercent, setAdjustmentPercent] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();

  // A never-configured buffer has nothing to toggle away from: the input
  // strip is always visible until the first save, matching the "this is
  // the common first-run state, not an error" framing.
  const showForm = canManage && (policy === null || isEditing);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const adjustmentRate = (Number(adjustmentPercent) / 100).toString();

    startTransition(async () => {
      const result = await saveFundingBufferPolicyAction({
        adjustmentRate,
        reason,
      });

      if (!result.ok) {
        setError('Check the highlighted fields and try again.');
        return;
      }

      toast.success(
        policy === null ? 'Funding buffer set.' : 'Funding buffer updated.',
      );
      setIsEditing(false);
      setAdjustmentPercent('');
      setReason('');
      router.refresh();
    });
  }

  return (
    <article className="flex flex-col rounded-lg border border-border bg-card">
      {policy === null ? (
        <div className="flex items-start justify-between gap-2 p-4">
          <DisclosureBanner tone="warning" className="flex-1">
            No funding buffer set. If you convert your own money (e.g. AUD) to
            top up a supplier wallet like CJ Wallet, set a buffer here so that
            conversion cost is reflected in every price. Category-margin pricing
            is unavailable until one is set.
          </DisclosureBanner>
          <PolicyHistoryButton
            title="History — Funding buffer"
            ariaLabel="Funding buffer history"
            fetchHistory={getFundingBufferHistoryAction}
          />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border p-4">
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="font-display text-[28px] font-semibold tracking-tight tabular-nums">
                {formatSignedPercent(policy.adjustmentRate)}
              </span>
              <span className="rounded-full bg-success-surface px-2 py-0.5 text-xs font-semibold text-green-700">
                Active
              </span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-ink-muted">
                v{policy.version}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {canManage ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setIsEditing((previous) => !previous)}
                  >
                    {isEditing ? 'Close' : 'Edit'}
                  </Button>
                  <DeactivateFundingBufferButton
                    policyId={policy.id}
                    sellerAccountId={sellerAccountId}
                  />
                </>
              ) : null}
              <PolicyHistoryButton
                title="History — Funding buffer"
                ariaLabel="Funding buffer history"
                fetchHistory={getFundingBufferHistoryAction}
              />
            </div>
          </div>
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-semibold text-ink-faint">
                Last changed
              </span>
              <span className="text-sm">
                {new Date(policy.updatedAt).toLocaleDateString()}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-semibold text-ink-faint">
                Reason given
              </span>
              <span className="text-sm text-ink-muted">{policy.reason}</span>
            </div>
          </div>
        </>
      )}

      {showForm ? (
        <form
          onSubmit={handleSubmit}
          noValidate
          className="flex flex-wrap items-end gap-3 border-t border-border bg-background p-4"
        >
          {error === null ? null : (
            <p
              role="alert"
              className="w-full rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          )}
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${fieldId}-rate`}>Buffer</Label>
            <div className="flex items-center gap-1">
              <Input
                id={`${fieldId}-rate`}
                type="number"
                inputMode="decimal"
                step="0.01"
                min="-20"
                max="20"
                required
                value={adjustmentPercent}
                onChange={(event) => setAdjustmentPercent(event.target.value)}
                aria-label="Funding buffer percentage"
                className="w-24 text-right"
              />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
          </div>
          <div className="flex min-w-[220px] flex-1 flex-col gap-1">
            <Label htmlFor={`${fieldId}-reason`}>Reason for change</Label>
            <Input
              id={`${fieldId}-reason`}
              required
              minLength={10}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Reason (min 10 characters)"
            />
          </div>
          <Button type="submit" disabled={isPending}>
            {saveButtonLabel(isPending, policy !== null)}
          </Button>
          <span className="w-full text-xs text-muted-foreground">
            Positive and negative values are both valid, within ±20%.
          </span>
        </form>
      ) : null}
    </article>
  );
}
