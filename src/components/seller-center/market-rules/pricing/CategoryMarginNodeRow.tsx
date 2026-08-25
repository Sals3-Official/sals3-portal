'use client';

/* eslint-disable react/jsx-no-bind -- handlers close over this row's own local state. */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { getCategoryPolicyHistoryAction } from '@/app/(portal)/market-rules/pricing-actions';
import { Button } from '@/components/ui/button';
import CategoryMarginDialog from './CategoryMarginDialog';
import DeactivateCategoryPolicyButton from './DeactivateCategoryPolicyButton';
import {
  ROW_GRID,
  type CategoryMarginNodeViewModel,
  type EffectiveMargin,
} from './category-margin-model';
import PolicyHistoryButton from './PolicyHistoryButton';

type CategoryMarginNodeRowProps = {
  node: CategoryMarginNodeViewModel;
  effective: EffectiveMargin;
  sellerAccountId: string;
  canManage: boolean;
  /** The destination being edited, or `null` for the all-destinations rule. */
  marketCode: string | null;
  /** Search mode: full path shown, no indent, no expand chevron. */
  flat: boolean;
  isExpanded: boolean;
  onToggleExpanded: () => void;
};

/**
 * `25.00%` reads as false precision on a number a person typed as `25`.
 * Whole rates render whole; only a genuinely fractional rate shows decimals.
 */
function formatPercent(rate: string): string {
  const value = Number(rate) * 100;
  const rounded = Math.round(value * 100) / 100;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(2)}%`;
}

/**
 * "Set on this category" collided with the button also labelled "Set" — the
 * same word for a state and for an action. These name the origin only.
 */
function sourceLabel(effective: EffectiveMargin): string {
  switch (effective.source) {
    case 'SELF':
      return 'This category';
    case 'ANCESTOR':
      return `From ${effective.ancestorName}`;
    case 'STORE_DEFAULT':
      return 'Store default';
    default:
      return 'Nothing yet';
  }
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

/**
 * One taxonomy node — department or group. The margin chip is solid green
 * when the node carries its own policy and a `sals3-bright`-outlined tint
 * when the rate is inherited: an inherited rate is real and effective, but
 * the outline says "editing the parent moves this too". `sals3-bright` is
 * used only as a border here, never as text (it fails 4.5:1 — see the
 * token's own doc comment); the chip text is `sals3-deep`, 14.3:1 on white.
 *
 * Editing happens in a pop-out, not inline — see `CategoryMarginDialog`.
 */
export default function CategoryMarginNodeRow({
  node,
  effective,
  sellerAccountId,
  canManage,
  marketCode,
  flat,
  isExpanded,
  onToggleExpanded,
}: CategoryMarginNodeRowProps) {
  const router = useRouter();
  const [isEditorOpen, setIsEditorOpen] = useState(false);

  /**
   * Close, then refresh — from here, because this component stays mounted
   * through both. The dialog cannot do it: closing unmounts it.
   */
  function handleSaved() {
    setIsEditorOpen(false);
    router.refresh();
  }

  const indent = flat ? 0 : (node.depth - 1) * 20;
  const hasChildren = node.childCount > 0;

  return (
    <>
      <div
        role="row"
        className={`${ROW_GRID} border-b border-border px-3 py-1.5 last:border-b-0 hover:bg-surface/60`}
      >
        <div
          role="cell"
          className="flex min-w-0 items-center gap-1"
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
            <span className="truncate text-[11px] text-ink-faint">
              {hasChildren
                ? `${node.subtreeCount.toLocaleString()} categories`
                : node.code}
            </span>
          </div>
        </div>

        <div role="cell">
          <MarginChip effective={effective} />
        </div>

        <div role="cell" className="min-w-0">
          <span
            className={`block truncate text-xs ${effective.source === 'SELF' ? 'text-ink-muted' : 'text-ink-faint'}`}
          >
            {sourceLabel(effective)}
          </span>
        </div>

        <div role="cell" className="flex items-center justify-end gap-1">
          {canManage ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsEditorOpen(true)}
            >
              {node.policy === null ? 'Set' : 'Edit'}
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

      {canManage && isEditorOpen ? (
        <CategoryMarginDialog
          node={node}
          effective={effective}
          marketCode={marketCode}
          open={isEditorOpen}
          onOpenChange={setIsEditorOpen}
          onSaved={handleSaved}
        />
      ) : null}
    </>
  );
}
