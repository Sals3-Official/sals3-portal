'use client';

/* eslint-disable react/jsx-no-bind -- handleSave closes over this row's own local editing state. */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  getCategoryPolicyHistoryAction,
  saveCategoryPolicyAction,
} from '@/app/(portal)/market-rules/pricing-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TableCell, TableRow } from '@/components/ui/table';
import type { RoundingRule } from '@/modules/pricing/money-math';
import DeactivateCategoryPolicyButton from './DeactivateCategoryPolicyButton';
import type { CategoryMarginLeafViewModel } from './CategoryMarginGroupList';
import PolicyHistoryButton from './PolicyHistoryButton';

type CategoryMarginLeafRowProps = {
  leaf: CategoryMarginLeafViewModel;
  sellerAccountId: string;
  canManage: boolean;
};

/**
 * One leaf category inside an expanded group. Single target, nothing to
 * overwrite — Save commits on the first click, no arming step (unlike
 * `CategoryMarginGroupRow`'s bulk Save).
 */
export default function CategoryMarginLeafRow({
  leaf,
  sellerAccountId,
  canManage,
}: CategoryMarginLeafRowProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [marginOverride, setMarginOverride] = useState<string | null>(null);
  const [roundingOverride, setRoundingOverride] = useState<RoundingRule | null>(
    null,
  );
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const marginPercent =
    marginOverride ??
    (leaf.policy === null
      ? ''
      : (Number(leaf.policy.targetMarginRate) * 100).toString());
  const roundingRule = roundingOverride ?? leaf.policy?.roundingRule ?? 'NONE';
  const ready = marginPercent.trim() !== '' && reason.trim().length >= 10;

  function handleSave() {
    setError(null);
    const targetMarginRate = (Number(marginPercent) / 100).toString();

    startTransition(async () => {
      const result = await saveCategoryPolicyAction({
        categoryCode: leaf.code,
        targetMarginRate,
        roundingRule,
        reason,
      });

      if (!result.ok) {
        setError('Check the highlighted fields and try again.');
        return;
      }

      toast.success(`Margin saved for ${leaf.path.split(' > ').pop()}.`);
      setMarginOverride(null);
      setRoundingOverride(null);
      setReason('');
      router.refresh();
    });
  }

  return (
    <TableRow className="bg-background">
      <TableCell colSpan={2} className="pl-11">
        <div className="flex flex-col gap-0.5">
          <span className="truncate text-sm">{leaf.path}</span>
          <span className="font-mono text-[11px] text-ink-faint">
            {leaf.code}
          </span>
        </div>
      </TableCell>
      <TableCell>
        {leaf.policy === null ? (
          <span className="inline-flex w-fit items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-ink-muted">
            Not set
          </span>
        ) : (
          <span className="inline-flex w-fit items-center rounded-full bg-success-surface px-2 py-0.5 text-[11px] font-semibold text-green-700">
            {(Number(leaf.policy.targetMarginRate) * 100).toFixed(2)}%
          </span>
        )}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <Input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0.01"
            max="99.99"
            value={marginPercent}
            onChange={(event) => setMarginOverride(event.target.value)}
            aria-label={`Margin percent for ${leaf.path}`}
            className="h-8 w-16 text-right"
            disabled={!canManage}
          />
          <span className="text-xs text-muted-foreground">%</span>
        </div>
      </TableCell>
      <TableCell>
        <Select
          value={roundingRule}
          onValueChange={(value) =>
            setRoundingOverride((value as RoundingRule | null) ?? 'NONE')
          }
          disabled={!canManage}
        >
          <SelectTrigger
            aria-label={`Rounding for ${leaf.path}`}
            className="h-8 text-xs"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="NONE">None — exact price</SelectItem>
            <SelectItem value="NEAREST_0_99">Nearest .99</SelectItem>
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Reason (min 10 characters)"
          aria-label={`Reason for change to ${leaf.path}`}
          className="h-8 text-xs"
          disabled={!canManage}
        />
      </TableCell>
      <TableCell>
        {canManage ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending || !ready}
            onClick={handleSave}
          >
            {isPending ? 'Saving…' : 'Save'}
          </Button>
        ) : null}
      </TableCell>
      <TableCell>
        <div className="flex flex-col items-start gap-1">
          <div className="flex items-center gap-2">
            <span className="text-[11px] whitespace-nowrap text-ink-faint">
              {leaf.policy === null
                ? 'No active policy'
                : `v${leaf.policy.version} · updated ${leaf.policy.updatedAt.toLocaleDateString()}`}
            </span>
            <PolicyHistoryButton
              title={`History — ${leaf.path.split(' > ').pop()}`}
              ariaLabel={`History for ${leaf.path}`}
              fetchHistory={() => getCategoryPolicyHistoryAction(leaf.code)}
            />
          </div>
          {canManage && leaf.policy !== null ? (
            <DeactivateCategoryPolicyButton
              policyId={leaf.policy.id}
              sellerAccountId={sellerAccountId}
              categoryPath={leaf.path}
            />
          ) : null}
          {error === null ? null : (
            <span role="alert" className="text-[11px] text-destructive">
              {error}
            </span>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
