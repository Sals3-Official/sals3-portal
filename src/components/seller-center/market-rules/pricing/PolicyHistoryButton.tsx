'use client';

/* eslint-disable react/jsx-no-bind -- handleOpenChange closes over this button's own local fetch state. */

import { useState } from 'react';
import { Clock } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import type { AuditHistoryEntry } from '@/modules/catalog/candidates/repository';
import type { ActionResult } from '@/app/(portal)/market-rules/pricing-actions';

type PolicyHistoryButtonProps = {
  title: string;
  ariaLabel: string;
  fetchHistory: () => Promise<ActionResult<AuditHistoryEntry[]>>;
};

const ACTION_LABELS: Record<string, string> = {
  'category_pricing_policy.created': 'Created',
  'category_pricing_policy.revised': 'Revised',
  'category_pricing_policy.deactivated': 'Deactivated',
  'funding_buffer_policy.created': 'Created',
  'funding_buffer_policy.revised': 'Revised',
  'funding_buffer_policy.deactivated': 'Deactivated',
};

/** Never the internal action code — a bulk write always reads "Bulk applied" regardless of created/revised underneath. */
function actionLabel(entry: AuditHistoryEntry): string {
  if (typeof entry.payload.bulkOperationId === 'string') return 'Bulk applied';
  return ACTION_LABELS[entry.action] ?? entry.action;
}

function formatRate(rate: string, signed: boolean): string {
  const percent = Number(rate) * 100;
  const sign = signed && percent > 0 ? '+' : '';
  return `${sign}${percent.toFixed(2)}%`;
}

/** `from → to` when the immediately-older entry in this same list also carries a rate; otherwise just the value this entry set. */
function describeValue(
  entry: AuditHistoryEntry,
  previous: AuditHistoryEntry | undefined,
): string | null {
  const rate = (entry.payload.targetMarginRate ??
    entry.payload.adjustmentRate) as string | undefined;
  if (rate === undefined) return null;

  const signed = entry.payload.adjustmentRate !== undefined;
  const current = formatRate(rate, signed);
  const previousRate = (previous?.payload.targetMarginRate ??
    previous?.payload.adjustmentRate) as string | undefined;

  if (previousRate !== undefined && entry.action.endsWith('.revised')) {
    return `${formatRate(previousRate, signed)} → ${current}`;
  }
  return current;
}

function reasonOf(entry: AuditHistoryEntry): string | null {
  return typeof entry.payload.reason === 'string' ? entry.payload.reason : null;
}

type HistoryBodyProps = {
  loading: boolean;
  error: boolean;
  entries: AuditHistoryEntry[] | null;
};

/** Early returns instead of a nested ternary chain — loading, then error, then empty, then the real list. */
function HistoryBody({ loading, error, entries }: HistoryBodyProps) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2" aria-label="Loading history">
        <div className="h-3 w-3/5 animate-pulse rounded bg-muted" />
        <div className="h-3 w-2/5 animate-pulse rounded bg-muted" />
        <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-xs text-destructive">
        History is not available right now.
      </p>
    );
  }

  if (entries === null || entries.length === 0) {
    return <p className="text-xs text-muted-foreground">No history yet.</p>;
  }

  return (
    <ol className="flex flex-col gap-3">
      {entries.map((entry, index) => {
        const value = describeValue(entry, entries[index + 1]);
        const reason = reasonOf(entry);

        return (
          <li key={entry.id} className="flex flex-col gap-0.5">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-xs font-semibold">
                {actionLabel(entry)}
              </span>
              {value === null ? null : (
                <span className="text-xs text-ink-muted">{value}</span>
              )}
              <span className="ml-auto text-[11px] whitespace-nowrap text-ink-faint">
                {new Date(entry.createdAt).toLocaleString()}
              </span>
            </div>
            <span className="text-xs text-muted-foreground">
              {entry.actorName}
            </span>
            {reason === null ? null : (
              <span className="text-xs leading-relaxed text-muted-foreground">
                {reason}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * First UI surface over `audit_events` (Part 3) — shared by category leaf
 * rows, category group rows (bulk changes only), and the funding-buffer
 * card. A `Popover`, never a dialog: anchored to its trigger, dismissible
 * by clicking away, does not block the page. Fetches lazily on first open,
 * not on every render of the row it lives in.
 */
export default function PolicyHistoryButton({
  title,
  ariaLabel,
  fetchHistory,
}: PolicyHistoryButtonProps) {
  const [entries, setEntries] = useState<AuditHistoryEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  function handleOpenChange(open: boolean) {
    if (!open || entries !== null || loading) return;

    setLoading(true);
    setError(false);
    fetchHistory()
      .then((result) => {
        if (result.ok) setEntries(result.data);
        else setError(true);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }

  return (
    <Popover onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={ariaLabel}
            className="flex size-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:border-border-strong"
          >
            <Clock aria-hidden="true" className="size-3.5" />
          </button>
        }
      />
      <PopoverContent className="w-80">
        <PopoverTitle>{title}</PopoverTitle>
        <div className="mt-2 max-h-64 overflow-y-auto">
          <HistoryBody loading={loading} error={error} entries={entries} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
