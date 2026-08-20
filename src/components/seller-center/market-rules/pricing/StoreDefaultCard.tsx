'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  getStoreDefaultHistoryAction,
  saveStoreDefaultAction,
} from '@/app/(portal)/market-rules/pricing-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import DisclosureBanner from '@/components/seller-center/shared/DisclosureBanner';
import type { RoundingRule } from '@/modules/pricing/money-math';
import type { PricingStoreDefaultRow } from '@/lib/db/schema';
import DeactivateStoreDefaultButton from './DeactivateStoreDefaultButton';
import StoreDefaultPreview from './StoreDefaultPreview';
import PolicyHistoryButton from './PolicyHistoryButton';

type StoreDefaultCardProps = {
  policy: PricingStoreDefaultRow | null;
  sellerAccountId: string;
  canManage: boolean;
};

/** Mirrors `MIN_REASON_LENGTH` in `pricing-actions.ts`. */
const MIN_REASON_CHARS = 10;

/**
 * One field's error, wired to the input by id so a screen reader reads the
 * two together. Before this the page said "check the highlighted fields"
 * and highlighted nothing.
 */
function FieldError({ id, message }: { id: string; message?: string }) {
  if (message === undefined) return null;

  return (
    <span id={id} role="alert" className="text-xs font-medium text-destructive">
      {message}
    </span>
  );
}

function saveButtonLabel(isPending: boolean, hasPolicy: boolean): string {
  if (isPending) return 'Saving…';
  return hasPolicy ? 'Save default' : 'Set the default';
}

function formatPercent(rate: string): string {
  return `${(Number(rate) * 100).toFixed(2)}%`;
}

function formatUsdMinor(minor: bigint): string {
  const whole = minor / BigInt(100);
  const cents = (minor % BigInt(100)).toString().padStart(2, '0');
  return `US$${whole.toString()}.${cents}`;
}

/**
 * The seller's single store-wide pricing default (ADR-015 §3's base
 * layer): one margin rate, one minimum-contribution floor, one rounding
 * rule. Every category without its own margin — or a priced parent —
 * resolves here, so this one card can cover the whole taxonomy. One card,
 * not a table: at most one active default exists per seller. Editing is
 * inline, matching `FundingBufferCard`.
 */
export default function StoreDefaultCard({
  policy,
  sellerAccountId,
  canManage,
}: StoreDefaultCardProps) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [marginPercent, setMarginPercent] = useState('');
  const [floorDollars, setFloorDollars] = useState('');
  const [roundingRule, setRoundingRule] = useState<RoundingRule>(
    policy?.roundingRule ?? 'NONE',
  );
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const fieldId = useId();

  // First-run state: nothing to toggle away from, the form is the card.
  const showForm = canManage && (policy === null || isEditing);

  /**
   * Client-side check, so the button can refuse a submit that the server is
   * certain to reject. The server still validates everything — this only
   * stops a person from being told "no" after a round trip for a rule the
   * form could have stated up front.
   */
  const reasonTooShort =
    reason.trim().length > 0 && reason.trim().length < MIN_REASON_CHARS;
  const canSubmit =
    marginPercent.trim() !== '' && reason.trim().length >= MIN_REASON_CHARS;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    const targetMarginRate = (Number(marginPercent) / 100).toString();

    startTransition(async () => {
      const result = await saveStoreDefaultAction({
        targetMarginRate,
        minContribution: floorDollars.trim() === '' ? '0' : floorDollars,
        roundingRule,
        reason,
      });

      if (!result.ok) {
        // Per-field messages when the server has them; a single line only
        // when it does not, so the page never claims to highlight a field it
        // has not highlighted.
        const errors =
          'fieldErrors' in result ? (result.fieldErrors ?? {}) : {};

        setFieldErrors(errors);
        setError(
          Object.keys(errors).length > 0
            ? null
            : 'The system could not save this. Try again.',
        );
        return;
      }

      toast.success(
        policy === null ? 'Store default set.' : 'Store default updated.',
      );
      setIsEditing(false);
      setMarginPercent('');
      setFloorDollars('');
      setReason('');
      setFieldErrors({});
      router.refresh();
    });
  }

  return (
    <article className="flex flex-col rounded-lg border border-border bg-card">
      {policy === null ? (
        <div className="flex items-start justify-between gap-2 p-4">
          <DisclosureBanner tone="warning" className="flex-1">
            No store default set, so every product still needs a price typed by
            hand before it can go live. Fill in the two numbers below once and
            every category prices itself from them.
          </DisclosureBanner>
          <PolicyHistoryButton
            title="History — Store default"
            ariaLabel="Store default history"
            fetchHistory={getStoreDefaultHistoryAction}
          />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border p-4">
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="font-display text-[28px] font-semibold tracking-tight tabular-nums">
                {formatPercent(policy.targetMarginRate)}
              </span>
              {policy.minContributionMinor > BigInt(0) ? (
                <span className="text-sm text-ink-muted">
                  or at least{' '}
                  <span className="font-semibold text-ink tabular-nums">
                    {formatUsdMinor(policy.minContributionMinor)}
                  </span>{' '}
                  above cost, whichever is higher
                </span>
              ) : (
                <span className="text-sm text-ink-faint">no floor</span>
              )}
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
                  <DeactivateStoreDefaultButton
                    policyId={policy.id}
                    sellerAccountId={sellerAccountId}
                  />
                </>
              ) : null}
              <PolicyHistoryButton
                title="History — Store default"
                ariaLabel="Store default history"
                fetchHistory={getStoreDefaultHistoryAction}
              />
            </div>
          </div>
          <div className="grid gap-3 p-4 sm:grid-cols-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-semibold text-ink-faint">
                Rounding
              </span>
              <span className="text-sm">
                {policy.roundingRule === 'NEAREST_0_99'
                  ? 'Nearest .99'
                  : 'None — exact price'}
              </span>
            </div>
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
            <Label htmlFor={`${fieldId}-margin`}>Your margin</Label>
            <div className="flex items-center gap-1">
              <Input
                id={`${fieldId}-margin`}
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.01"
                max="99.99"
                required
                value={marginPercent}
                onChange={(event) => setMarginPercent(event.target.value)}
                aria-label="Default margin percent"
                aria-invalid={fieldErrors.targetMarginRate !== undefined}
                aria-describedby={`${fieldId}-margin-error`}
                className="w-24 text-right"
              />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
            <span className="text-xs text-ink-faint">
              This is your part of the selling price.
            </span>
            <FieldError
              id={`${fieldId}-margin-error`}
              message={fieldErrors.targetMarginRate}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${fieldId}-floor`}>Minimum profit per item</Label>
            <div className="flex items-center gap-1">
              <span className="text-sm text-muted-foreground">US$</span>
              <Input
                id={`${fieldId}-floor`}
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={floorDollars}
                onChange={(event) => setFloorDollars(event.target.value)}
                aria-label="Minimum profit per item in US dollars"
                aria-invalid={fieldErrors.minContribution !== undefined}
                aria-describedby={`${fieldId}-floor-error`}
                className="w-24 text-right"
              />
            </div>
            <span className="text-xs text-ink-faint">
              This is your smallest profit for one item.
            </span>
            <FieldError
              id={`${fieldId}-floor-error`}
              message={fieldErrors.minContribution}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${fieldId}-rounding`}>Rounding</Label>
            <Select
              value={roundingRule}
              onValueChange={(value) =>
                setRoundingRule((value as RoundingRule | null) ?? 'NONE')
              }
            >
              <SelectTrigger
                id={`${fieldId}-rounding`}
                aria-label="Rounding rule"
                className="w-44"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">None — exact price</SelectItem>
                <SelectItem value="NEAREST_0_99">Nearest .99</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex min-w-[220px] flex-1 flex-col gap-1">
            <Label htmlFor={`${fieldId}-reason`}>Reason for change</Label>
            <Input
              id={`${fieldId}-reason`}
              required
              minLength={MIN_REASON_CHARS}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why did you change this?"
              aria-invalid={fieldErrors.reason !== undefined || reasonTooShort}
              aria-describedby={`${fieldId}-reason-hint`}
            />
            <span
              id={`${fieldId}-reason-hint`}
              className={
                reasonTooShort
                  ? 'text-xs font-medium text-destructive'
                  : 'text-xs text-ink-faint'
              }
            >
              {`Use ${MIN_REASON_CHARS} characters or more. You have ${reason.trim().length}.`}
            </span>
            <FieldError
              id={`${fieldId}-reason-error`}
              message={fieldErrors.reason}
            />
          </div>
          <Button type="submit" disabled={isPending || !canSubmit}>
            {saveButtonLabel(isPending, policy !== null)}
          </Button>
          <StoreDefaultPreview
            marginPercent={marginPercent}
            floorAmount={floorDollars}
            roundingRule={roundingRule}
          />
          <span className="w-full text-xs text-muted-foreground">
            This is margin. It is not markup. A markup of 30% gives the same
            price as a margin of 23.08%.
          </span>
        </form>
      ) : null}

      <div className="border-t border-border px-4 py-2.5">
        <p className="text-xs text-ink-faint">
          Product price only — shipping is quoted separately at checkout. These
          two numbers have to cover card fees, Sals3 commission and returns, and
          none of those are set up yet, so keep them conservative and revisit
          once the real payment rail exists.
        </p>
      </div>
    </article>
  );
}
