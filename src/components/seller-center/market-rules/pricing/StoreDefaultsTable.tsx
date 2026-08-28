'use client';

/* eslint-disable react/jsx-no-bind -- handlers close over this table's own local state. */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import type { PricingScope } from '@/modules/pricing/pricing-scope-destinations';
import {
  markupPercentFromMarginRateScaled,
  parseScaledRate,
} from '@/modules/pricing/money-math';
import StoreDefaultDialog from './StoreDefaultDialog';
import {
  floorOf,
  STORE_DEFAULT_ROW_GRID,
  type StoreDefaultViewModel,
} from './store-default-model';

type StoreDefaultsTableProps = {
  /** One row each, in the order they are shown — the six, then Global. */
  scopes: PricingScope[];
  /** Keyed by scope key; a scope with no rule maps to `null`. */
  storeDefaults: Record<string, StoreDefaultViewModel | null>;
  canManage: boolean;
};

/**
 * Markup over cost — the unit the import sheet, the Product Editor and the
 * category table all speak. See `CategoryMarginNodeRow.formatPercent` for why
 * they were unified.
 *
 * The stored value is a margin rate either way; the conversion happens here so
 * the seller reads back the number they typed. Both the reserve and (in
 * history) the retired base markup go through this — they are the same unit,
 * which is what #244 fixed.
 */
function formatPercent(rate: string): string {
  const value = markupPercentFromMarginRateScaled(parseScaledRate(rate));
  const rounded = Math.round(value * 100) / 100;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(2)}%`;
}

/** `.99` or `Exact`, or an em dash when the scope has no rule at all. */
function formatRounding(storeDefault: StoreDefaultViewModel | null): string {
  if (storeDefault === null) return '—';
  return storeDefault.roundingRule === 'NEAREST_0_99' ? '.99' : 'Exact';
}

function formatAmount(minor: number, currency: string): string {
  return `${currency === 'USD' ? 'US$' : `${currency} `}${(minor / 100).toFixed(2)}`;
}

/**
 * A row per scope rather than one card, for the same reason the category
 * margins became columns: operating expense is not the same number in every
 * country, and a screen that shows one at a time hides the comparison the
 * seller is here to make.
 *
 * Deliberately a table and not a card each. These are five short values per
 * scope; cards would be a heading, a border and a page of scrolling to compare
 * two numbers.
 *
 * The Global row arrives here as data — it is whatever `scopes` carries — so
 * this component gained a seventh row on 2026-08-27 without a line changing.
 */
export default function StoreDefaultsTable({
  scopes,
  storeDefaults,
  canManage,
}: StoreDefaultsTableProps) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);

  const editingScope =
    editing === null
      ? null
      : (scopes.find((scope) => scope.key === editing) ?? null);

  function handleSaved() {
    setEditing(null);
    router.refresh();
  }

  return (
    <>
      <div
        role="table"
        aria-label="Store defaults"
        className="overflow-hidden rounded-lg border border-border"
      >
        <div
          role="row"
          className={`${STORE_DEFAULT_ROW_GRID} border-b border-border bg-surface px-3 py-1.5`}
        >
          {/*
            "Scope", not "Destination" — the last row is Global, which is not a
            destination. A heading that named one would be wrong for exactly the
            row a seller is least sure about.
          */}
          {['Scope', 'Reserve', 'Rounding', ''].map((heading) => (
            <span
              key={heading === '' ? 'actions' : heading}
              role="columnheader"
              className={`text-[11px] font-bold tracking-wider text-ink-faint uppercase ${heading === '' ? 'text-right' : ''}`}
            >
              {heading === '' ? 'Edit' : heading}
            </span>
          ))}
        </div>

        {scopes.map((scope) => {
          const storeDefault = storeDefaults[scope.key] ?? null;
          const floor = floorOf(storeDefault);

          return (
            <div
              role="row"
              key={scope.key}
              className={`${STORE_DEFAULT_ROW_GRID} border-b border-border px-3 py-1.5 last:border-b-0 hover:bg-surface/60`}
            >
              <div role="cell" className="min-w-0">
                <span className="truncate text-sm">{scope.label}</span>
              </div>

              <div role="cell" className="min-w-0">
                {/*
                  One value, never two. The exclusivity is a database
                  constraint, so there is no precedence to show and no "both"
                  state to render.
                */}
                <span className="truncate text-sm tabular-nums">
                  {floor.kind === 'RATE' ? formatPercent(floor.rate) : null}
                  {floor.kind === 'AMOUNT'
                    ? formatAmount(floor.minor, floor.currency)
                    : null}
                  {floor.kind === 'NONE' ? (
                    <span className="text-ink-faint">None</span>
                  ) : null}
                </span>
              </div>

              <div role="cell">
                <span className="text-xs text-ink-muted">
                  {formatRounding(storeDefault)}
                </span>
              </div>

              <div role="cell" className="flex justify-end">
                {canManage ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`${storeDefault === null ? 'Set' : 'Edit'} store default for ${scope.label}`}
                    onClick={() => setEditing(scope.key)}
                  >
                    {storeDefault === null ? 'Set' : 'Edit'}
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {canManage && editingScope !== null ? (
        <StoreDefaultDialog
          scope={editingScope}
          storeDefault={storeDefaults[editingScope.key] ?? null}
          open
          onOpenChange={(next) => setEditing(next ? editing : null)}
          onSaved={handleSaved}
        />
      ) : null}
    </>
  );
}
