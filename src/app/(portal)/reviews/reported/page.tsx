import type { Metadata } from 'next';
import PageHeader from '@/components/portal/PageHeader';
import SourcingEmptyState from '@/components/products/cj/SourcingEmptyState';
import ReportedReviewCard from '@/components/reviews/ReportedReviewCard';
import { PermissionError } from '@/lib/auth/permissions';
import { requirePermission } from '@/lib/auth/session';
import { readOrUnavailable } from '@/lib/db/availability';
import getDb, { isDatabaseConfigured } from '@/lib/db/client';

export const metadata: Metadata = {
  title: 'Reported reviews · Sals3 Portal',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const TITLE = 'Reported reviews';
const DESCRIPTION =
  'Reviews a customer has asked someone to look at. Nothing is hidden until a decision is made here.';

/** Small on purpose: this is a queue to work through, not a table to browse. */
const PAGE_SIZE = 20;

/**
 * The platform moderation queue.
 *
 * ## Who can open this, and who deliberately cannot
 *
 * `review:moderate`. Held by `admin` and `catalogue_reviewer`; **no seller role
 * holds it**. That is the substance of ADR-014 — a seller who can hide
 * criticism of their own listing turns every remaining rating into a marketing
 * claim — and it is enforced by the permission rather than by which repository
 * serves the page.
 *
 * ADR-014 names the Admin Portal as the eventual home. That repository is
 * sign-in and shell only today, so a queue placed there would be a queue nobody
 * can open, and a report button with nothing behind it is a promise the
 * platform is not keeping. When the Admin Portal grows real capabilities this
 * moves; the permission boundary does not change when it does.
 *
 * ## Not scoped to a seller account
 *
 * Every other read under `(portal)` filters on the session's own seller. This
 * one must not: a platform moderator works across sellers, and scoping the
 * queue to their own account would hide the reviews it exists to handle.
 *
 * ## Absent tables are named as a migration gap, not dressed as an outage
 *
 * `sals3_product_review_flags` reaches a deployed database through a
 * `workflow_dispatch`, not through the deploy, so there is a real window where
 * this screen exists and its table does not. The whole lesson of the PR #102
 * incident is that a migration gap has to be legible as one.
 */
const NOT_MIGRATED = 'NOT_MIGRATED' as const;
const DENIED = 'DENIED' as const;

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={TITLE} description={DESCRIPTION} />
      {children}
    </div>
  );
}

export default async function ReportedReviewsPage() {
  if (!isDatabaseConfigured()) {
    return (
      <Frame>
        <SourcingEmptyState
          title="No database configured in this environment"
          description="DATABASE_URL is not set here, so reported reviews cannot be read."
        />
      </Frame>
    );
  }

  const resolved = await readOrUnavailable('reported reviews', async () => {
    try {
      await requirePermission('review:moderate');
    } catch (error) {
      if (error instanceof PermissionError) return DENIED;

      throw error;
    }

    const { readReviewExtrasPresence } =
      await import('@/modules/reviews/migrate-review-extras');
    const present = await readReviewExtrasPresence(getDb());

    if (!present.flagsTable) return NOT_MIGRATED;

    const { listReportedReviews, readReportedReviewPhotos } =
      await import('@/modules/reviews/moderation');
    const page = await listReportedReviews({ page: 1, limit: PAGE_SIZE });

    // One read per card that actually has photos, and at most `PAGE_SIZE` of
    // them. Not folded into the list query: a join to a one-to-many would make
    // the `LIMIT` bound photos rather than reviews, which is the same trap
    // `listPublicReviewsBySlug` avoids.
    const photos = await Promise.all(
      page.rows.map(async (row) =>
        row.photoCount === 0
          ? []
          : readReportedReviewPhotos(row.reviewId, getDb()),
      ),
    );

    return { page, photos };
  });

  if (!resolved.ok) {
    return (
      <Frame>
        <SourcingEmptyState
          title="Cannot reach the database right now"
          description="This queue could not be loaded because the database did not respond. Nothing was changed."
        />
      </Frame>
    );
  }

  if (resolved.data === DENIED) {
    return (
      <Frame>
        <SourcingEmptyState
          title="Your account cannot moderate reviews"
          description="Withholding a customer's review is platform authority, not a seller's. A seller can answer a review and cannot hide one — that separation is what makes the ratings on a listing worth reading."
        />
      </Frame>
    );
  }

  if (resolved.data === NOT_MIGRATED) {
    return (
      <Frame>
        <SourcingEmptyState
          title="Reporting is not set up in this environment yet"
          description="The review flag table has not been created in this database. Run the Reviews Migrate Review Extras workflow, then reload. No report can exist until it has run, so there is nothing to see here and nothing was changed."
        />
      </Frame>
    );
  }

  const { page, photos } = resolved.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={TITLE} description={DESCRIPTION} />

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
          A report is a request for a look, never an automatic hide — otherwise
          a competitor with four accounts could delete a rating. Oldest first,
          so volume cannot jump the queue.{' '}
          <strong className="font-semibold text-ink">Hide</strong> removes the
          review from the storefront and stops it counting toward the
          product&rsquo;s average.{' '}
          <strong className="font-semibold text-ink">Keep</strong> changes
          nothing and records that it was considered.
        </p>
      </div>

      {page.rows.length === 0 ? (
        <SourcingEmptyState
          title="Nothing is waiting"
          description="No customer has asked for a review to be looked at. This queue fills only when somebody reports one, and it stays empty for as long as nobody does."
        />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-[0.8125rem] text-ink-subtle">
            {page.total} {page.total === 1 ? 'review' : 'reviews'} waiting on a
            decision.
          </p>
          {page.rows.map((row, index) => (
            <ReportedReviewCard
              key={row.reviewId}
              review={row}
              photos={photos[index] ?? []}
            />
          ))}
        </div>
      )}
    </div>
  );
}
