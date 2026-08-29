import Link from 'next/link';
import type { ReviewsTab } from '@/lib/portal/review-params';

type ReviewsPageTabsProps = {
  active: ReviewsTab;
  /** Published reviews on the account. */
  reviewCount: number;
  /** Units sold, not products — the Sold tab's headline figure. `null` when the
      order tables are absent, which renders no badge rather than a false zero. */
  soldUnits: number | null;
};

const TABS: Array<{ id: ReviewsTab; label: string; href: string }> = [
  { id: 'reviews', label: 'Reviews', href: '/reviews' },
  { id: 'sold', label: 'Sold', href: '/reviews?view=sold' },
];

/**
 * The page's two tabs.
 *
 * Links rather than client state, so a tab is a URL a seller can bookmark or
 * send — the same rule the filters below already follow. Switching tabs
 * deliberately drops the star and text filters instead of carrying them across:
 * "4-star, no reply" has no meaning on a table of units sold, and a filter that
 * survives into a screen with no control to clear it is a trap.
 *
 * `aria-current="page"` rather than a `tablist` role: these are navigations to
 * a new URL, not panels swapped in place, and announcing them as tabs would
 * promise keyboard behaviour (arrow-key roving) that links do not have.
 */
export default function ReviewsPageTabs({
  active,
  reviewCount,
  soldUnits,
}: ReviewsPageTabsProps) {
  return (
    <nav
      aria-label="Reviews and sales"
      className="flex gap-0.5 border-b border-border"
    >
      {TABS.map((tab) => {
        const current = tab.id === active;
        const count = tab.id === 'reviews' ? reviewCount : soldUnits;

        return (
          <Link
            key={tab.id}
            href={tab.href}
            aria-current={current ? 'page' : undefined}
            className={`-mb-px inline-flex min-h-11 items-center gap-1.5 border-b-2 px-4 text-sm transition-colors hover:no-underline ${
              current
                ? 'border-brand-600 font-semibold text-brand-600'
                : 'border-transparent font-medium text-ink-subtle hover:text-ink'
            }`}
          >
            {tab.label}
            {count === null ? null : (
              <span
                className={`inline-flex h-[1.1875rem] items-center rounded px-1.5 text-[0.6875rem] font-semibold tabular-nums ${
                  current
                    ? 'bg-brand-100 text-brand-700'
                    : 'bg-muted text-ink-subtle'
                }`}
              >
                {count.toLocaleString('en-US')}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
