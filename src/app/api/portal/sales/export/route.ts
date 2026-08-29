import { PermissionError } from '@/lib/auth/permissions';
import { requireDropshipperAccount } from '@/lib/auth/seller-guard';
import getDb, { isDatabaseConfigured } from '@/lib/db/client';
import {
  parseSoldRange,
  soldRangeLabel,
  type ReviewSearchParams,
} from '@/lib/portal/review-params';
import { salesCsvFilename, soldRowsToCsv } from '@/lib/portal/sales-csv';
import { readSellerSoldRows } from '@/modules/orders/seller-sold-read';
import { orderTablesExist } from '@/modules/orders/table-presence';

/**
 * The Sold tab as a downloadable spreadsheet.
 *
 * ## Authorisation is the same one the screen uses, resolved server-side
 *
 * `requireDropshipperAccount` reads the session cookie and returns the seller
 * account; the id is never taken from the query string. That matters more here
 * than on the page: this response carries **revenue**, and a seller id accepted
 * from a caller would hand one seller another's takings for the price of
 * editing a URL.
 *
 * ## The window comes from the same parser as the screen
 *
 * The export must be the thing the seller is looking at. Re-deriving the range
 * here with a second implementation is how an export quietly drifts from its
 * table — so `parseSoldRange` is shared, and the filename carries the window.
 *
 * ## Not cached, ever
 *
 * A per-seller, per-window, money-bearing response has no business in a shared
 * cache. `force-dynamic` plus explicit no-store.
 */
export const dynamic = 'force-dynamic';

const NO_STORE = {
  'Cache-Control': 'no-store, max-age=0',
  // The download is text/csv; the sniffing guard keeps a browser from deciding
  // otherwise about seller-authored content.
  'X-Content-Type-Options': 'nosniff',
} as const;

export async function GET(request: Request) {
  if (!isDatabaseConfigured()) {
    return new Response('Sales cannot be read in this environment.', {
      status: 503,
      headers: NO_STORE,
    });
  }

  let sellerAccountId: string;

  try {
    const { sellerAccount } = await requireDropshipperAccount();
    sellerAccountId = sellerAccount.id;
  } catch (error) {
    if (error instanceof PermissionError) {
      return new Response('Not permitted.', {
        status: 403,
        headers: NO_STORE,
      });
    }

    throw error;
  }

  if (!(await orderTablesExist(getDb()))) {
    return new Response(
      'The order tables have not been created in this database, so there is nothing to export.',
      { status: 409, headers: NO_STORE },
    );
  }

  const { searchParams } = new URL(request.url);
  const params: ReviewSearchParams = {
    range: searchParams.get('range') ?? undefined,
    from: searchParams.get('from') ?? undefined,
    to: searchParams.get('to') ?? undefined,
  };
  const range = parseSoldRange(params, new Date());
  const rows = await readSellerSoldRows(sellerAccountId, range);

  return new Response(soldRowsToCsv(rows), {
    status: 200,
    headers: {
      ...NO_STORE,
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${salesCsvFilename(soldRangeLabel(range))}"`,
    },
  });
}
