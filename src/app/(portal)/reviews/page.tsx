import type { Metadata } from 'next';
import PageHeader from '@/components/portal/PageHeader';
import SourcingEmptyState from '@/components/products/cj/SourcingEmptyState';
import ReviewsTabPanel from '@/components/reviews/ReviewsTabPanel';
import ReviewsPageTabs from '@/components/sales/ReviewsPageTabs';
import SoldTabPanel from '@/components/sales/SoldTabPanel';
import { requireDropshipperAccount } from '@/lib/auth/seller-guard';
import { readOrUnavailable } from '@/lib/db/availability';
import getDb, { isDatabaseConfigured } from '@/lib/db/client';
import {
  parseReviewsTab,
  parseReviewView,
  parseSoldRange,
  REVIEWS_PAGE_SIZE,
  type ReviewSearchParams,
  type SoldRange,
} from '@/lib/portal/review-params';
import {
  readSellerSoldRows,
  readSellerSoldSummary,
  type SellerSoldRow,
  type SellerSoldSummary,
} from '@/modules/orders/seller-sold-read';
import { orderTablesExist } from '@/modules/orders/table-presence';
import {
  listSellerReviews,
  readSellerReviewSummary,
} from '@/modules/reviews/seller-read';

export const metadata: Metadata = {
  title: 'Reviews and Sales · Sals3 Portal',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const TITLE = 'Reviews & Sales';
const DESCRIPTION =
  'What customers wrote about the items you sold them, and how many of each you have sold.';

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
 * The Sold tab, or an explanation of why it cannot run.
 *
 * Split out so the route's own return stays a single ternary between two tabs.
 * A null summary means the order tables are absent, which is a migration gap
 * and is named as one — not an empty table, which would read as "you have sold
 * nothing" and be a lie.
 */
function SoldTab({
  summary,
  rows,
  range,
  exportQuery,
}: {
  summary: SellerSoldSummary | null;
  rows: SellerSoldRow[] | null;
  range: SoldRange;
  exportQuery: string;
}) {
  if (summary === null || rows === null) {
    return (
      <SourcingEmptyState
        title="Sales are not set up in this environment yet"
        description="The order tables have not been created in this database, so nothing has been sold through it and there is nothing to count. Apply the order migration through the break-glass workflow, then reload. Reviews on the other tab are unaffected."
      />
    );
  }

  return (
    <SoldTabPanel
      summary={summary}
      rows={rows}
      range={range}
      exportQuery={exportQuery}
    />
  );
}

/**
 * The window, as the export route will read it back.
 *
 * Only the three keys the route parses are forwarded. Passing the whole query
 * through would let a star filter or a page number ride along into a URL that
 * ignores them, which reads as though they applied.
 */
function soldExportQuery(params: ReviewSearchParams): string {
  const search = new URLSearchParams();

  if (params.range !== undefined) search.set('range', params.range);
  if (params.from !== undefined) search.set('from', params.from);
  if (params.to !== undefined) search.set('to', params.to);

  const query = search.toString();

  return query === '' ? '' : `?${query}`;
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={TITLE} description={DESCRIPTION} />
      {children}
    </div>
  );
}

/**
 * Reviews & Sales.
 *
 * Composition and data orchestration only — both tabs, the bands, the filters
 * and the tables are their own components, and every filter lives in the URL so
 * a view is shareable and the back button behaves.
 *
 * Reads real rows. There is no fixture path: an empty database renders the
 * empty state, which says *why* it is empty rather than implying a problem.
 *
 * The order tables are checked separately from the review tables and their
 * absence does not take the page down. On a selectively-migrated database the
 * Reviews tab is genuinely usable while the Sold tab has nothing to read, and
 * failing both would be a worse answer than failing the one that cannot work.
 */
export default async function ReviewsAndSalesPage({
  searchParams,
}: {
  searchParams: Promise<ReviewSearchParams>;
}) {
  if (!isDatabaseConfigured()) {
    return (
      <Frame>
        <SourcingEmptyState
          title="No database configured in this environment"
          description="DATABASE_URL is not set here, so reviews and sales cannot be read."
        />
      </Frame>
    );
  }

  const params = await searchParams;
  const tab = parseReviewsTab(params);
  const view = parseReviewView(params);
  // Resolved once, here: the table, the band and the export all have to describe
  // the same window, and a second `new Date()` further down could land on the
  // other side of midnight from this one.
  const range = parseSoldRange(params, new Date());
  const exportQuery = soldExportQuery(params);

  const resolved = await readOrUnavailable('reviews and sales', async () => {
    const { sellerAccount } = await requireDropshipperAccount();

    if (!(await reviewTablesExist())) return NOT_MIGRATED;

    const hasOrderTables = await orderTablesExist(getDb());

    // Both reads are scoped to this session's seller account. The summary is
    // not derived from the filtered page: the headline numbers must describe
    // the whole account, or "31 need a reply" would silently mean "31 on this
    // page of this filter".
    const [summary, page, soldSummary, soldRows] = await Promise.all([
      readSellerReviewSummary(sellerAccount.id),
      listSellerReviews({
        sellerAccountId: sellerAccount.id,
        filter: view.filter,
        page: view.page,
        limit: REVIEWS_PAGE_SIZE,
      }),
      hasOrderTables ? readSellerSoldSummary(sellerAccount.id, range) : null,
      hasOrderTables ? readSellerSoldRows(sellerAccount.id, range) : null,
    ]);

    return { summary, page, soldSummary, soldRows };
  });

  if (!resolved.ok) {
    return (
      <Frame>
        <SourcingEmptyState
          title="Cannot reach the database right now"
          description="This page could not be loaded because the database did not respond. Nothing was changed."
        />
      </Frame>
    );
  }

  if (resolved.data === NOT_MIGRATED) {
    return (
      <Frame>
        <SourcingEmptyState
          title="Reviews are not set up in this environment yet"
          description="The review tables have not been created in this database. Run the Reviews Migrate Product Reviews workflow, then reload. No review can exist until it has run, so there is nothing to see here and nothing was changed."
        />
      </Frame>
    );
  }

  const { summary, page, soldSummary, soldRows } = resolved.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={TITLE} description={DESCRIPTION} />

      <ReviewsPageTabs
        active={tab}
        reviewCount={summary.count}
        soldUnits={soldSummary?.totalUnits ?? null}
      />

      {tab === 'sold' ? (
        <SoldTab
          summary={soldSummary}
          rows={soldRows}
          range={range}
          exportQuery={exportQuery}
        />
      ) : (
        <ReviewsTabPanel
          summary={summary}
          rows={page.rows}
          total={page.total}
          filter={view.filter}
        />
      )}
    </div>
  );
}
