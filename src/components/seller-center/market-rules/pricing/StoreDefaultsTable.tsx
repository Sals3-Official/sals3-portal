'use client';

/* eslint-disable react/jsx-no-bind -- handlers close over this table's own local state. */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import type { PricingScopeDestination } from '@/modules/pricing/pricing-scope-destinations';
import StoreDefaultDialog from './StoreDefaultDialog';
import {
  floorOf,
  STORE_DEFAULT_ROW_GRID,
  type StoreDefaultViewModel,
} from './store-default-model';

type StoreDefaultsTableProps = {
  destinations: PricingScopeDestination[];
  /** Keyed by destination code; a destination with no rule maps to `null`. */
  storeDefaults: Record<string, StoreDefaultViewModel | null>;
  canManage: boolean;
};

function formatPercent(rate: string): string {
  const value = Number(rate) * 100;
  const rounded = Math.round(value * 100) / 100;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(2)}%`;
}

/** `.99` or `Exact`, or an em dash when the destination has no rule at all. */
function formatRounding(storeDefault: StoreDefaultViewModel | null): string {
  if (storeDefault === null) return '—';
  return storeDefault.roundingRule === 'NEAREST_0_99' ? '.99' : 'Exact';
}

function formatAmount(minor: number, currency: string): string {
  return `${currency === 'USD' ? 'US$' : `${currency} `}${(minor / 100).toFixed(2)}`;
}

/**
 * A row per destination rather than one card, for the same reason the category
 * margins became columns: operating expense is not the same number in every
 * country, and a screen that shows one at a time hides the comparison the
 * seller is here to make.
 *
 * Deliberately a table and not six cards. These are five short values each; six
 * cards would be six headings, six borders and a page of scrolling to compare
 * two numbers.
 */
export default function StoreDefaultsTable({
  destinations,
  storeDefaults,
  canManage,
}: StoreDefaultsTableProps) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);

  const editingDestination =
    editing === null
      ? null
      : (destinations.find((destination) => destination.code === editing) ??
        null);

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
          {['Destination', 'Base margin', 'Minimum', 'Rounding', ''].map(
            (heading) => (
              <span
                key={heading === '' ? 'actions' : heading}
                role="columnheader"
                className={`text-[11px] font-bold tracking-wider text-ink-faint uppercase ${heading === '' ? 'text-right' : ''}`}
              >
                {heading === '' ? 'Edit' : heading}
              </span>
            ),
          )}
        </div>

        {destinations.map((destination) => {
          const storeDefault = storeDefaults[destination.code] ?? null;
          const floor = floorOf(storeDefault);

          return (
            <div
              role="row"
              key={destination.code}
              className={`${STORE_DEFAULT_ROW_GRID} border-b border-border px-3 py-1.5 last:border-b-0 hover:bg-surface/60`}
            >
              <div role="cell" className="min-w-0">
                <span className="truncate text-sm">{destination.label}</span>
              </div>

              <div role="cell">
                <span className="text-sm tabular-nums">
                  {storeDefault === null
                    ? '—'
                    : formatPercent(storeDefault.targetMarginRate)}
                </span>
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
                    aria-label={`${storeDefault === null ? 'Set' : 'Edit'} store default for ${destination.label}`}
                    onClick={() => setEditing(destination.code)}
                  >
                    {storeDefault === null ? 'Set' : 'Edit'}
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {canManage && editingDestination !== null ? (
        <StoreDefaultDialog
          destination={editingDestination}
          storeDefault={storeDefaults[editingDestination.code] ?? null}
          open
          onOpenChange={(next) => setEditing(next ? editing : null)}
          onSaved={handleSaved}
        />
      ) : null}
    </>
  );
}
