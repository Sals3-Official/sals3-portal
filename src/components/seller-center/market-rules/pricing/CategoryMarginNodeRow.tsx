'use client';

/* eslint-disable react/jsx-no-bind -- handlers close over this row's own local state. */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { getCategoryPolicyHistoryAction } from '@/app/(portal)/market-rules/pricing-actions';
import { Button } from '@/components/ui/button';
import type { PricingScopeDestination } from '@/modules/pricing/pricing-scope-destinations';
import CategoryMarginDialog from './CategoryMarginDialog';
import {
  effectiveMarginFor,
  ROW_GRID,
  type CategoryMarginNodeViewModel,
  type EffectiveMargin,
  type StoreDefaultSummary,
} from './category-margin-model';
import PolicyHistoryButton from './PolicyHistoryButton';

type CategoryMarginNodeRowProps = {
  node: CategoryMarginNodeViewModel;
  nodesByPath: Map<string, CategoryMarginNodeViewModel>;
  destinations: PricingScopeDestination[];
  storeDefaults: Record<string, StoreDefaultSummary | null>;
  sellerAccountId: string;
  canManage: boolean;
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
 * What a cell means, spelled out for the tooltip and the screen reader.
 *
 * The column header already says which destination this is, so these name the
 * origin only. With the source column gone, this string is the only place an
 * inherited rate explains itself in words.
 */
function sourceLabel(effective: EffectiveMargin): string {
  switch (effective.source) {
    case 'SELF':
      return effective.viaAllMarkets
        ? 'Set on this category for all destinations'
        : 'Set on this category';
    case 'ANCESTOR':
      return effective.viaAllMarkets
        ? `From ${effective.ancestorName}, for all destinations`
        : `From ${effective.ancestorName}`;
    case 'STORE_DEFAULT':
      return 'Store default';
    default:
      return 'Nothing yet';
  }
}

/**
 * One destination's rate for one category.
 *
 * Solid green when the category carries its own rule for this destination, a
 * `sals3-bright`-outlined tint when the rate is inherited: an inherited rate is
 * real and effective, but the outline says "editing the parent moves this too".
 * `sals3-bright` is used only as a border (it fails 4.5:1 — see the token's own
 * doc comment); the chip text is `sals3-deep`, 14.3:1 on white.
 */
function MarginChip({ effective }: { effective: EffectiveMargin }) {
  if (effective.source === 'NONE') {
    return (
      <span className="inline-flex w-full items-center justify-center rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-ink-muted">
        —
      </span>
    );
  }

  if (effective.source === 'SELF' && !effective.viaAllMarkets) {
    return (
      <span className="inline-flex w-full items-center justify-center rounded-full bg-success-surface px-1.5 py-0.5 text-[11px] font-bold whitespace-nowrap text-green-700 tabular-nums">
        {formatPercent(effective.rate)}
      </span>
    );
  }

  return (
    <span className="inline-flex w-full items-center justify-center rounded-full border border-sals3-bright px-1.5 py-0.5 text-[11px] font-bold whitespace-nowrap text-sals3-deep tabular-nums">
      {formatPercent(effective.rate)}
    </span>
  );
}

/**
 * One taxonomy node — department or group — across every open destination.
 *
 * Owner decision 2026-08-25: the destinations are columns rather than a mode
 * the whole screen is switched into. Reading a rate for one country used to
 * mean reloading the page and holding the previous number in your head; the
 * point of a column is that the comparison is the default view, not a task.
 *
 * Editing happens in a pop-out opened from the cell, so the click that says
 * which destination is the same click that opens the editor — there is no
 * separate step in which the two could disagree.
 */
export default function CategoryMarginNodeRow({
  node,
  nodesByPath,
  destinations,
  storeDefaults,
  sellerAccountId,
  canManage,
  flat,
  isExpanded,
  onToggleExpanded,
}: CategoryMarginNodeRowProps) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);

  /**
   * Close, then refresh — from here, because this component stays mounted
   * through both. The dialog cannot do it: closing unmounts it.
   */
  function handleSaved() {
    setEditing(null);
    router.refresh();
  }

  const indent = flat ? 0 : (node.depth - 1) * 20;
  const hasChildren = node.childCount > 0;
  const editingDestination =
    editing === null
      ? null
      : (destinations.find((destination) => destination.code === editing) ??
        null);

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

        {destinations.map((destination) => {
          const effective = effectiveMarginFor(
            node,
            nodesByPath,
            storeDefaults[destination.code] ?? null,
            destination.code,
          );
          const description = `${destination.label}: ${sourceLabel(effective)}`;

          return (
            <div role="cell" key={destination.code} className="min-w-0">
              {canManage ? (
                <button
                  type="button"
                  // The destination is named in the label, not only in the
                  // column position — a screen reader gets no column header
                  // from a CSS grid.
                  aria-label={`${node.name} — ${description}. Edit.`}
                  title={description}
                  className="w-full cursor-pointer rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  onClick={() => setEditing(destination.code)}
                >
                  <MarginChip effective={effective} />
                </button>
              ) : (
                <span title={description} aria-label={description}>
                  <MarginChip effective={effective} />
                </span>
              )}
            </div>
          );
        })}

        <div role="cell" className="flex items-center justify-end">
          <PolicyHistoryButton
            title={`History — ${node.name}`}
            ariaLabel={`Policy history for ${node.path}`}
            fetchHistory={() => getCategoryPolicyHistoryAction(node.code)}
          />
        </div>
      </div>

      {canManage && editingDestination !== null ? (
        <CategoryMarginDialog
          node={node}
          destination={editingDestination}
          effective={effectiveMarginFor(
            node,
            nodesByPath,
            storeDefaults[editingDestination.code] ?? null,
            editingDestination.code,
          )}
          sellerAccountId={sellerAccountId}
          open
          onOpenChange={(next) => setEditing(next ? editing : null)}
          onSaved={handleSaved}
        />
      ) : null}
    </>
  );
}
