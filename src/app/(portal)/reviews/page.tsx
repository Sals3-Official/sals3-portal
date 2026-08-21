import type { Metadata } from 'next';
import PageHeader from '@/components/portal/PageHeader';
import SourcingEmptyState from '@/components/products/cj/SourcingEmptyState';
import ReviewFilterBar from '@/components/reviews/ReviewFilterBar';
import ReviewList from '@/components/reviews/ReviewList';
import ReviewSummaryBand from '@/components/reviews/ReviewSummaryBand';
import { requireDropshipperAccount } from '@/lib/auth/seller-guard';
import { readOrUnavailable } from '@/lib/db/availability';
import getDb, { isDatabaseConfigured } from '@/lib/db/client';
import {
  parseReviewView,
  REVIEWS_PAGE_SIZE,
  type ReviewSearchParams,
} from '@/lib/portal/review-params';
import { REVIEW_WINDOW_DAYS } from '@/modules/reviews/contracts';
import {
  listSellerReviews,
  readSellerReviewSummary,
} from '@/modules/reviews/seller-read';

export const metadata: Metadata = {
  title: 'Product Reviews · Sals3 Portal',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const DESCRIPTION = 'What customers wrote about the items you sold them.';

/**
 * Distinguishes "not migrated yet" from "the database is down".
 *
 * `sals3_product_reviews` reaches a deployed database through a
 * `workflow_dispatch`, not through the deploy, so there is a real window where
 * this screen exists and its tables do not. Without this the seller would meet
 * an error page on a brand-new menu item, and `readOrUnavailable` would not
 * catch it either: that helper treats only connection-class errors as
 * unavailable and rethrows the rest, which is correct — a portal-wide helper
 * that swallowed `undefined_table` would hide genuine schema drift everywhere.
 *
 * So the check is here, it is explicit, and its copy names the workflow. A
 * missing table is deliberately **not** dressed up as an outage: the whole
 * lesson of the PR #102 incident is that a migration gap has to be legible as a
 * migration gap.
 */
const NOT_MIGRATED = 'NOT_MIGRATED' as const;

async function reviewTablesExist(): Promise<boolean> {
  const { readExistingReviewTables } =
    await import('@/modules/reviews/migrate-product-reviews');
  const tables = await readExistingReviewTables(getDb());

  return tables.productReviews && tables.productReviewReplies;
}

/**
 * Product Reviews.
 *
 * Composition and data orchestration only — the band, the filters and the list
 * are their own components, and every filter lives in the URL so a view is
 * shareable and the back button behaves.
 *
 * Reads real rows. There is no fixture path: an empty database renders the
 * empty state, which says *why* it is empty rather than implying a problem.
 */
export default async function ProductReviewsPage({
  searchParams,
}: {
  searchParams: Promise<ReviewSearchParams>;
}) {
  if (!isDatabaseConfigured()) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Product Reviews" description={DESCRIPTION} />
        <SourcingEmptyState
          title="No database configured in this environment"
          description="DATABASE_URL is not set here, so reviews cannot be read."
        />
      </div>
    );
  }

  const view = parseReviewView(await searchParams);

  const resolved = await readOrUnavailable('product reviews', async () => {
    const { sellerAccount } = await requireDropshipperAccount();

    if (!(await reviewTablesExist())) return NOT_MIGRATED;

    // Both reads are scoped to this session's seller account. The summary is
    // not derived from the filtered page: the headline numbers must describe
    // the whole account, or "31 need a reply" would silently mean "31 on this
    // page of this filter".
    const [summary, page] = await Promise.all([
      readSellerReviewSummary(sellerAccount.id),
      listSellerReviews({
        sellerAccountId: sellerAccount.id,
        filter: view.filter,
        page: view.page,
        limit: REVIEWS_PAGE_SIZE,
      }),
    ]);

    return { summary, page };
  });

  if (!resolved.ok) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Product Reviews" description={DESCRIPTION} />
        <SourcingEmptyState
          title="Cannot reach the database right now"
          description="Reviews could not be loaded because the database did not respond. Nothing was changed."
        />
      </div>
    );
  }

  if (resolved.data === NOT_MIGRATED) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Product Reviews" description={DESCRIPTION} />
        <SourcingEmptyState
          title="Reviews are not set up in this environment yet"
          description="The review tables have not been created in this database. Run the Reviews Migrate Product Reviews workflow, then reload. No review can exist until it has run, so there is nothing to see here and nothing was changed."
        />
      </div>
    );
  }

  const { summary, page } = resolved.data;
  const filtered =
    view.filter.replyState !== null ||
    view.filter.ratings.length > 0 ||
    view.filter.query !== '';

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Product Reviews" description={DESCRIPTION} />

      <div className="flex gap-2.5 rounded-lg border border-border bg-card p-3.5">
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
          className="mt-px size-4 shrink-0 text-brand-600"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
        >
          <circle cx="8" cy="8" r="6.2" />
          <path d="M8 7.2v4M8 4.9v.1" />
        </svg>
        <p className="text-[0.8125rem] leading-relaxed text-ink-muted">
          A customer can write a review only after the parcel that carried the
          item is <strong className="font-semibold text-ink">Delivered</strong>,
          and only for {REVIEW_WINDOW_DAYS} days after that. One review for each
          item in the order. You can answer a review one time, and you can
          change your answer later. You cannot delete a customer&rsquo;s review.
        </p>
      </div>

      <ReviewSummaryBand summary={summary} />

      <div className="rounded-lg border border-border bg-card">
        <ReviewFilterBar
          counts={{
            all: summary.count,
            needsReply: summary.needsReply,
            replied: summary.count - summary.needsReply,
          }}
          breakdown={summary.breakdown}
          activeTab={view.filter.replyState}
          activeStars={view.filter.ratings}
          query={view.filter.query}
        />

        {page.rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2.5 px-6 py-14 text-center">
            <svg
              viewBox="0 0 16 16"
              aria-hidden="true"
              className="size-8 text-border-strong"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.1"
            >
              <path d="M8 1.6l1.9 3.9 4.3.6-3.1 3 .8 4.3L8 11.4l-3.9 2 .8-4.3-3.1-3 4.3-.6z" />
            </svg>
            <span className="font-display text-base font-semibold text-ink">
              {filtered ? 'No reviews match these filters' : 'No reviews yet'}
            </span>
            <p className="max-w-[46ch] text-[0.8125rem] leading-relaxed text-ink-subtle">
              {filtered
                ? 'Clear a filter to see the rest.'
                : `A customer can write a review after their parcel is marked Delivered. You have ${summary.deliveredLines} delivered ${summary.deliveredLines === 1 ? 'item' : 'items'} that nobody has reviewed. Nothing to do here yet.`}
            </p>
          </div>
        ) : (
          <>
            <div className="hidden gap-4 border-b border-border bg-background px-4 py-2.5 md:grid md:grid-cols-[18.75rem_1fr_12.5rem]">
              <span className="text-xs font-medium text-ink-subtle">
                Item as it was ordered
              </span>
              <span className="text-xs font-medium text-ink-subtle">
                Rating and review
              </span>
              <span className="text-xs font-medium text-ink-subtle">
                Your reply
              </span>
            </div>
            <ReviewList reviews={page.rows} />
            <p className="px-4 py-3.5 text-xs text-ink-subtle">
              Showing {page.rows.length} of {page.total}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
