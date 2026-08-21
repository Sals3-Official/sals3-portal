'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import {
  buildReviewQuery,
  type ReviewSearchParams,
} from '@/lib/portal/review-params';
import type { RatingSummary } from '@/modules/reviews/contracts';
import StarRating from './StarRating';

type ReviewFilterBarProps = {
  counts: { all: number; needsReply: number; replied: number };
  breakdown: RatingSummary['breakdown'];
  activeTab: 'needs-reply' | 'replied' | null;
  activeStars: number[];
  query: string;
};

const TABS = [
  { key: null, label: 'All' },
  { key: 'needs-reply' as const, label: 'Needs reply' },
  { key: 'replied' as const, label: 'Replied' },
];

/**
 * Extracted so the counts stay a lookup rather than a chain of ternaries the
 * lint config rightly refuses — three nested conditionals in JSX is where an
 * off-by-one hides.
 */
function tabTotal(
  key: 'needs-reply' | 'replied' | null,
  counts: ReviewFilterBarProps['counts'],
): number {
  if (key === null) return counts.all;

  return key === 'needs-reply' ? counts.needsReply : counts.replied;
}

/** Selected wins over low: a chip the seller has turned on must look on. */
function chipTone(active: boolean, low: boolean): string {
  if (active) return 'border-brand-600 bg-brand-100 text-brand-900';

  return low
    ? 'border-danger-border bg-danger-surface text-red-700'
    : 'border-input bg-card text-ink-muted hover:bg-accent';
}

/**
 * The filter row: reply state as a segmented control, ratings as toggle chips.
 *
 * Chips rather than the checkbox row the marketplace screenshot uses. A
 * checkbox list needs two actions to see one rating on its own — untick the
 * others, or untick "all" first — while a chip is one tap, and the shape says
 * "narrowing" rather than "configuring".
 *
 * Every change is a navigation, not local state, so the URL is the single
 * source of truth (deep-linkable, back-button correct) and the server does the
 * filtering in SQL rather than the browser re-filtering a page it already has.
 * The search box is the one exception: it holds local text until submit,
 * because navigating per keystroke would be a query per keystroke.
 */
export default function ReviewFilterBar({
  counts,
  breakdown,
  activeTab,
  activeStars,
  query,
}: ReviewFilterBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [draftQuery, setDraftQuery] = useState(query);

  const current: ReviewSearchParams = {
    tab: searchParams.get('tab') ?? undefined,
    stars: searchParams.get('stars') ?? undefined,
    q: searchParams.get('q') ?? undefined,
    page: searchParams.get('page') ?? undefined,
  };

  function go(patch: Partial<ReviewSearchParams>) {
    router.push(buildReviewQuery(current, patch));
  }

  function toggleStar(star: number) {
    const next = activeStars.includes(star)
      ? activeStars.filter((value) => value !== star)
      : [...activeStars, star].sort((left, right) => left - right);

    go({ stars: next.join(',') });
  }

  return (
    <div className="flex flex-col gap-3.5 border-b border-border p-4">
      <div className="flex flex-wrap items-center gap-3.5">
        <div
          role="tablist"
          aria-label="Reply state"
          className="flex rounded-md border border-input bg-background p-0.5"
        >
          {TABS.map((tab) => {
            const active = tab.key === activeTab;
            const total = tabTotal(tab.key, counts);

            return (
              <button
                key={tab.label}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => go({ tab: tab.key ?? '' })}
                className={`h-[1.875rem] cursor-pointer rounded px-3 text-[0.8125rem] transition-colors duration-150 ${
                  active
                    ? 'bg-card font-semibold text-brand-900 shadow-sm'
                    : 'font-medium text-ink-subtle hover:text-ink'
                }`}
              >
                {tab.label} {total}
              </button>
            );
          })}
        </div>

        <div className="hidden h-6 w-px bg-border sm:block" />

        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-ink-subtle">Stars</span>
          <div className="flex flex-wrap gap-1.5">
            {[5, 4, 3, 2, 1].map((star) => {
              const active = activeStars.includes(star);
              const low = star <= 2;

              return (
                <button
                  key={star}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleStar(star)}
                  className={`flex h-[1.875rem] cursor-pointer items-center gap-1 rounded-full border px-2.5 text-xs font-semibold transition-colors duration-150 ${chipTone(active, low)}`}
                >
                  {star}
                  <StarRating rating={1} size="sm" label="" />
                  <span className="font-medium opacity-75 tabular-nums">
                    {breakdown[star - 1] ?? 0}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <form
        className="flex flex-wrap items-center gap-2.5"
        onSubmit={(event) => {
          event.preventDefault();
          go({ q: draftQuery });
        }}
      >
        <label className="w-full sm:w-[21.25rem]" htmlFor="review-search">
          <span className="sr-only">Search reviews</span>
          <input
            id="review-search"
            type="search"
            value={draftQuery}
            onChange={(event) => setDraftQuery(event.target.value)}
            placeholder="Product name, order number, or review text"
            maxLength={80}
            className="h-9 w-full rounded-md border border-input bg-card px-3 text-[0.8125rem] text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <button
          type="submit"
          className="h-9 cursor-pointer rounded-md bg-primary px-4 text-[0.8125rem] font-semibold text-primary-foreground transition-colors duration-150 hover:bg-brand-700"
        >
          Apply
        </button>
        <button
          type="button"
          onClick={() => {
            setDraftQuery('');
            router.push('/reviews');
          }}
          className="h-9 cursor-pointer rounded-md border border-input bg-card px-3.5 text-[0.8125rem] font-medium text-ink-muted transition-colors duration-150 hover:bg-accent"
        >
          Reset
        </button>
      </form>
    </div>
  );
}
