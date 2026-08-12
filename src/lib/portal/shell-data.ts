import getDb, { isDatabaseConfigured } from '@/lib/db/client';
import { isDatabaseUnavailableError } from '@/lib/db/availability';
import type { PortalSession } from '@/lib/auth/session';
import { type CandidateStatusCounts } from '@/modules/catalog/candidates/queries';
import {
  findConnectionBySellerAndProvider,
  findProviderByCode,
} from '@/modules/suppliers/repository';
import type { ConnectionSummary } from '@/components/portal/PortalSidebar';
import readCandidateStatusCounts from '@/modules/catalog/candidates/status-counts-cache';

export type PortalShellData = {
  connectionSummary: ConnectionSummary;
  sourcingCounts: CandidateStatusCounts | null;
};

/**
 * Nothing to show, and that is the truth: the viewer is not a dropshipper, or
 * this environment has no database at all. The footer's "connect a supplier"
 * prompt is correct here.
 */
const NO_DATA: PortalShellData = {
  connectionSummary: null,
  sourcingCounts: null,
};

/** We could not find out. Never rendered as "no supplier connected". */
const UNREADABLE: PortalShellData = {
  connectionSummary: 'UNREADABLE',
  sourcingCounts: null,
};

/**
 * Best-effort enrichment for the shared portal shell (rail badges, footer
 * connection health) - rendered on every portal page regardless of role, so
 * it must never throw. The layout already resolved the authenticated session
 * and seller row; reuse that identity here instead of doing another
 * `getSession()` + seller lookup on every navigation.
 *
 * This must never throw: it renders on every portal page, so an exception here
 * takes down navigation itself, not one screen. But "never throw" previously
 * meant every failure collapsed into `NO_DATA`, and `NO_DATA`'s footer reads
 * "Connect a Supplier App to start sourcing" - so a seller with a healthy CJ
 * connection was told to go connect one whenever the database was briefly
 * unreachable. A read failure and an empty result are now different values.
 *
 * An unexpected error still logs at `error`, unlike the handled unavailability
 * path in `db/availability.ts`. A bug in the shell is exactly the kind of thing
 * that should be loud, and nothing else on the page will report it.
 */
export async function resolvePortalShellData(
  session: PortalSession,
): Promise<PortalShellData> {
  if (!isDatabaseConfigured()) return NO_DATA;
  if (
    session.sellerBusinessModel !== 'DROPSHIPPER' ||
    session.sellerId === 'system'
  ) {
    return NO_DATA;
  }

  try {
    const db = getDb();
    const provider = await findProviderByCode(db, 'CJ_DROPSHIPPING');
    const connection =
      provider === null
        ? null
        : await findConnectionBySellerAndProvider(
            db,
            session.sellerId,
            provider.id,
          );

    const sourcingCounts = await readCandidateStatusCounts(session.sellerId);

    return {
      connectionSummary:
        connection === null || provider === null
          ? null
          : {
              status: connection.status,
              providerDisplayName: provider.displayName,
            },
      sourcingCounts,
    };
  } catch (error) {
    if (!isDatabaseUnavailableError(error)) {
      // eslint-disable-next-line no-console
      console.error(
        '[portal] shell data failed unexpectedly',
        error instanceof Error ? error.message : 'Unknown error',
      );
    }

    return UNREADABLE;
  }
}
