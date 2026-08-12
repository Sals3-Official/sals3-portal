'use client';

/* eslint-disable react/jsx-no-bind -- handlers close over this row's own local editing state. */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import {
  getCategoryGroupHistoryAction,
  saveCategoryGroupMarginAction,
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
import CategoryMarginLeafRow from './CategoryMarginLeafRow';
import type { CategoryMarginGroupViewModel } from './CategoryMarginGroupList';
import PolicyHistoryButton from './PolicyHistoryButton';

type CategoryMarginGroupRowProps = {
  group: CategoryMarginGroupViewModel;
  sellerAccountId: string;
  canManage: boolean;
  isExpanded: boolean;
  onToggleExpanded: () => void;
};

const STATE_PILL_CLASS: Record<
  CategoryMarginGroupViewModel['marginState'],
  string
> = {
  UNSET: 'bg-muted text-ink-muted',
  UNIFORM: 'bg-success-surface text-green-700',
  MIXED: 'bg-warning-surface text-amber-700',
};

function statePillLabel(group: CategoryMarginGroupViewModel): string {
  if (group.marginState === 'UNSET') return 'Not set';
  if (group.marginState === 'MIXED') return 'Mixed';
  return `${(Number(group.uniformRate) * 100).toFixed(2)}%`;
}

function saveButtonLabel(
  isPending: boolean,
  armed: boolean,
  setCount: number,
): string {
  if (isPending) return 'Saving…';
  if (armed) return `Confirm: overwrite ${setCount}`;
  return 'Save';
}

function marginRange(group: CategoryMarginGroupViewModel): string | null {
  const rates = group.leaves
    .map((leaf) => leaf.policy?.targetMarginRate)
    .filter((rate): rate is string => rate !== undefined)
    .map((rate) => Number(rate) * 100);
  if (rates.length === 0) return null;
  const min = Math.min(...rates);
  const max = Math.max(...rates);
  return min === max ? null : `${min.toFixed(0)}%–${max.toFixed(0)}%`;
}

/**
 * One Sals3 L1>L2 group. Typing a margin here and confirming bulk-writes
 * every one of the group's current leaves in one server action — see
 * `saveCategoryGroupMarginAction`. A group that already has any active
 * policy (UNIFORM/MIXED) requires a second confirming click, with an
 * inline warning naming the exact blast radius; a group with nothing set
 * (UNSET) commits on the first click, since there is nothing to overwrite.
 */
export default function CategoryMarginGroupRow({
  group,
  sellerAccountId,
  canManage,
  isExpanded,
  onToggleExpanded,
}: CategoryMarginGroupRowProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [marginOverride, setMarginOverride] = useState<string | null>(null);
  const [roundingOverride, setRoundingOverride] = useState<RoundingRule | null>(
    null,
  );
  const [reason, setReason] = useState('');
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const marginPercent =
    marginOverride ??
    (group.uniformRate === null
      ? ''
      : (Number(group.uniformRate) * 100).toString());
  const roundingRule = roundingOverride ?? group.uniformRoundingRule ?? 'NONE';
  const ready = marginPercent.trim() !== '' && reason.trim().length >= 10;

  function disarm() {
    if (armed) setArmed(false);
  }

  function commit() {
    setError(null);
    const targetMarginRate = (Number(marginPercent) / 100).toString();

    startTransition(async () => {
      const result = await saveCategoryGroupMarginAction({
        l1: group.l1,
        l2: group.l2,
        targetMarginRate,
        roundingRule,
        reason,
      });

      if (!result.ok) {
        setError('Check the highlighted fields and try again.');
        return;
      }

      toast.success(`Margin saved for ${group.leafCount} categories.`);
      setMarginOverride(null);
      setRoundingOverride(null);
      setReason('');
      setArmed(false);
      router.refresh();
    });
  }

  function handleSaveClick() {
    if (group.marginState === 'UNSET' || armed) {
      commit();
      return;
    }
    setArmed(true);
  }

  const differingCount = group.leaves.filter((leaf) => {
    if (leaf.policy === null) return false;
    const rateDiffers =
      Number(leaf.policy.targetMarginRate) * 100 !== Number(marginPercent);
    return rateDiffers || leaf.policy.roundingRule !== roundingRule;
  }).length;

  return (
    <>
      <TableRow className={armed ? 'bg-[#FFFDF8]' : undefined}>
        <TableCell>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-expanded={isExpanded}
            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${group.l2}`}
            onClick={onToggleExpanded}
          >
            <ChevronRight
              aria-hidden="true"
              className={
                isExpanded
                  ? 'rotate-90 transition-transform'
                  : 'transition-transform'
              }
            />
          </Button>
        </TableCell>
        <TableCell>
          <div className="flex flex-col gap-0.5">
            <span className="flex min-w-0 items-baseline text-sm">
              <span className="min-w-0 flex-shrink truncate text-ink-faint">
                {group.l1}
              </span>
              <span className="mx-1 flex-none text-ink-faint">›</span>
              <span className="flex-none font-semibold">{group.l2}</span>
            </span>
            <span className="text-[11px] text-ink-faint">
              {group.setCount}/{group.leafCount} set
              {marginRange(group) === null ? '' : ` · ${marginRange(group)}`}
            </span>
          </div>
        </TableCell>
        <TableCell>
          <span
            className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${STATE_PILL_CLASS[group.marginState]}`}
          >
            {statePillLabel(group)}
          </span>
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
              onChange={(event) => {
                setMarginOverride(event.target.value);
                disarm();
              }}
              aria-label={`Margin percent for ${group.l2}`}
              className="h-8 w-16 text-right"
              disabled={!canManage}
            />
            <span className="text-xs text-muted-foreground">%</span>
          </div>
        </TableCell>
        <TableCell>
          <Select
            value={roundingRule}
            onValueChange={(value) => {
              setRoundingOverride((value as RoundingRule | null) ?? 'NONE');
              disarm();
            }}
            disabled={!canManage}
          >
            <SelectTrigger
              aria-label={`Rounding for ${group.l2}`}
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
            onChange={(event) => {
              setReason(event.target.value);
              disarm();
            }}
            placeholder="Reason (min 10 characters)"
            aria-label={`Reason for change to ${group.l2}`}
            className="h-8 text-xs"
            disabled={!canManage}
          />
        </TableCell>
        <TableCell>
          {canManage ? (
            <Button
              type="button"
              variant={armed ? 'destructive' : 'outline'}
              size="sm"
              disabled={isPending || !ready}
              onClick={handleSaveClick}
            >
              {saveButtonLabel(isPending, armed, group.setCount)}
            </Button>
          ) : null}
        </TableCell>
        <TableCell>
          <PolicyHistoryButton
            title={`History — ${group.l2} (bulk changes)`}
            ariaLabel={`Bulk change history for ${group.l2}`}
            fetchHistory={() =>
              getCategoryGroupHistoryAction(group.l1, group.l2)
            }
          />
        </TableCell>
      </TableRow>

      {armed ? (
        <TableRow>
          <TableCell colSpan={8} className="bg-warning-surface/40 px-3 py-0">
            <div className="flex flex-wrap items-center gap-2.5 py-2.5">
              <TriangleAlert
                aria-hidden="true"
                className="size-4 flex-none text-amber-700"
              />
              <span className="text-xs leading-relaxed text-amber-700">
                This will overwrite {group.setCount} of {group.leafCount}{' '}
                categories currently priced under {group.l2}
                {group.marginState === 'MIXED' && differingCount > 0
                  ? `, including ${differingCount} set to a different rate.`
                  : '.'}
              </span>
              <button
                type="button"
                onClick={() => setArmed(false)}
                className="ml-auto text-xs font-semibold text-primary underline"
              >
                Cancel
              </button>
            </div>
          </TableCell>
        </TableRow>
      ) : null}

      {error === null ? null : (
        <TableRow>
          <TableCell colSpan={8} className="px-3 py-1">
            <span role="alert" className="text-xs text-destructive">
              {error}
            </span>
          </TableCell>
        </TableRow>
      )}

      {isExpanded ? (
        <>
          {group.leaves.map((leaf) => (
            <CategoryMarginLeafRow
              key={leaf.categoryId}
              leaf={leaf}
              sellerAccountId={sellerAccountId}
              canManage={canManage}
            />
          ))}
          <TableRow>
            <TableCell
              colSpan={8}
              className="bg-background pl-11 text-[11px] text-ink-faint"
            >
              A leaf saves on its own — one category, nothing to overwrite, so
              no confirm step.
            </TableCell>
          </TableRow>
        </>
      ) : null}
    </>
  );
}
