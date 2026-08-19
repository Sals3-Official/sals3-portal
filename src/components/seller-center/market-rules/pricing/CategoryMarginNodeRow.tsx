'use client';

/* eslint-disable react/jsx-no-bind -- handlers close over this row's own local editing state. */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
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
import type { RoundingRule } from '@/modules/pricing/money-math';
import DeactivateCategoryPolicyButton from './DeactivateCategoryPolicyButton';
import type {
  CategoryMarginNodeViewModel,
  EffectiveMargin,
} from './CategoryMarginTree';
import PolicyHistoryButton from './PolicyHistoryButton';

type CategoryMarginNodeRowProps = {
  node: CategoryMarginNodeViewModel;
  effective: EffectiveMargin;
  sellerAccountId: string;
  canManage: boolean;
  /** Search mode: full path shown, no indent, no expand chevron. */
  flat: boolean;
  isExpanded: boolean;
  onToggleExpanded: () => void;
};

function editButtonLabel(isEditing: boolean, hasPolicy: boolean): string {
  if (isEditing) return 'Close';
  return hasPolicy ? 'Edit' : 'Set';
}

function formatPercent(rate: string): string {
  return `${(Number(rate) * 100).toFixed(2)}%`;
}

function MarginChip({ effective }: { effective: EffectiveMargin }) {
  if (effective.source === 'NONE') {
    return (
      <span className="inline-flex w-fit items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-ink-muted">
        Not set
      </span>
    );
  }

  if (effective.source === 'SELF') {
    return (
      <span className="inline-flex w-fit items-center rounded-full bg-success-surface px-2 py-0.5 text-[11px] font-bold whitespace-nowrap text-green-700 tabular-nums">
        {formatPercent(effective.rate)}
      </span>
    );
  }

  return (
    <span className="inline-flex w-fit items-center rounded-full border border-sals3-bright px-2 py-0.5 text-[11px] font-bold whitespace-nowrap text-sals3-deep tabular-nums">
      {formatPercent(effective.rate)}
    </span>
  );
}

function sourceLabel(effective: EffectiveMargin): string {
  switch (effective.source) {
    case 'SELF':
      return 'Set on this category';
    case 'ANCESTOR':
      return `Inherited from ${effective.ancestorName}`;
    case 'STORE_DEFAULT':
      return 'Inherits store default';
    default:
      return 'No policy anywhere';
  }
}

/**
 * One taxonomy node. The margin chip is solid green when the node carries
 * its own policy and a `sals3-bright`-outlined tint when the rate is
 * inherited — an inherited rate is real and effective, but the outline
 * says "editing the parent moves this too". `sals3-bright` is used only as
 * a border here, never as text (it fails 4.5:1 — see the token's own doc
 * comment); the chip text is `sals3-deep`, 14.3:1 on white.
 *
 * Save commits on the first click: with inheritance, setting a branch no
 * longer overwrites any child's own policy (children with their own rate
 * keep it — they sit deeper in the chain), so the old bulk-overwrite
 * arming step has nothing left to guard against.
 */
export default function CategoryMarginNodeRow({
  node,
  effective,
  sellerAccountId,
  canManage,
  flat,
  isExpanded,
  onToggleExpanded,
}: CategoryMarginNodeRowProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isEditing, setIsEditing] = useState(false);
  const [marginPercent, setMarginPercent] = useState('');
  const [roundingRule, setRoundingRule] = useState<RoundingRule>(
    node.policy?.roundingRule ?? 'NONE',
  );
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const ready = marginPercent.trim() !== '' && reason.trim().length >= 10;
  const indent = flat ? 0 : (node.depth - 1) * 22;
  const hasChildren = node.childCount > 0;

  function openEditor() {
    setMarginPercent(
      node.policy === null
        ? ''
        : (Number(node.policy.targetMarginRate) * 100).toString(),
    );
    setRoundingRule(node.policy?.roundingRule ?? 'NONE');
    setReason('');
    setError(null);
    setIsEditing(true);
  }

  function handleSave() {
    setError(null);
    const targetMarginRate = (Number(marginPercent) / 100).toString();

    startTransition(async () => {
      const result = await saveCategoryPolicyAction({
        categoryCode: node.code,
        targetMarginRate,
        roundingRule,
        reason,
      });

      if (!result.ok) {
        setError('Check the fields and try again.');
        return;
      }

      toast.success(`Margin saved for ${node.name}.`);
      setIsEditing(false);
      router.refresh();
    });
  }

  return (
    <>
      <div
        role="row"
        className="grid grid-cols-[minmax(0,1fr)_130px_minmax(140px,210px)_auto] items-center gap-3 border-b border-border px-3 py-2 last:border-b-0"
      >
        <div
          role="cell"
          className="flex min-w-0 items-center gap-1.5"
          style={indent === 0 ? undefined : { paddingLeft: `${indent}px` }}
        >
          {hasChildren && !flat ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-expanded={isExpanded}
              aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${node.name}`}
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
          ) : (
            <span aria-hidden="true" className="w-7 shrink-0" />
          )}
          <div className="flex min-w-0 flex-col">
            <span
              className={`truncate text-sm ${node.depth === 1 && !flat ? 'font-semibold' : ''}`}
            >
              {flat ? node.path : node.name}
            </span>
            <span className="text-[11px] text-ink-faint">
              {hasChildren
                ? `${node.subtreeCount.toLocaleString()} categories`
                : node.code}
            </span>
          </div>
        </div>

        <div role="cell">
          <MarginChip effective={effective} />
        </div>

        <div role="cell">
          <span
            className={`text-xs ${effective.source === 'SELF' ? 'text-ink-muted' : 'text-ink-faint'}`}
          >
            {sourceLabel(effective)}
          </span>
        </div>

        <div role="cell" className="flex items-center justify-end gap-1.5">
          {canManage ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => (isEditing ? setIsEditing(false) : openEditor())}
            >
              {editButtonLabel(isEditing, node.policy !== null)}
            </Button>
          ) : null}
          {canManage && node.policy !== null ? (
            <DeactivateCategoryPolicyButton
              policyId={node.policy.id}
              sellerAccountId={sellerAccountId}
              categoryPath={node.path}
            />
          ) : null}
          <PolicyHistoryButton
            title={`History — ${node.name}`}
            ariaLabel={`Policy history for ${node.path}`}
            fetchHistory={() => getCategoryPolicyHistoryAction(node.code)}
          />
        </div>
      </div>

      {isEditing ? (
        <div className="flex flex-wrap items-end gap-3 border-b border-l-[3px] border-b-border border-l-sals3-bright bg-surface px-3 py-3">
          {error === null ? null : (
            <p role="alert" className="w-full text-xs text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-ink-muted">
              Margin
            </span>
            <div className="flex items-center gap-1">
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.01"
                max="99.99"
                value={marginPercent}
                onChange={(event) => setMarginPercent(event.target.value)}
                aria-label={`Margin percent for ${node.path}`}
                className="h-8 w-20 text-right"
              />
              <span className="text-xs text-muted-foreground">%</span>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-ink-muted">
              Rounding
            </span>
            <Select
              value={roundingRule}
              onValueChange={(value) =>
                setRoundingRule((value as RoundingRule | null) ?? 'NONE')
              }
            >
              <SelectTrigger
                aria-label={`Rounding for ${node.path}`}
                className="h-8 w-40 text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">None — exact price</SelectItem>
                <SelectItem value="NEAREST_0_99">Nearest .99</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex min-w-[200px] flex-1 flex-col gap-1">
            <span className="text-[11px] font-semibold text-ink-muted">
              Reason for change
            </span>
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Reason (min 10 characters)"
              aria-label={`Reason for change to ${node.path}`}
              className="h-8 text-xs"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending || !ready}
            onClick={handleSave}
          >
            {isPending ? 'Saving…' : 'Save'}
          </Button>
          {hasChildren ? (
            <span className="w-full text-[11px] text-ink-faint">
              Covers all {node.subtreeCount.toLocaleString()} categories under{' '}
              {node.name} that don&apos;t set their own margin. Categories with
              their own rate keep it.
            </span>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
