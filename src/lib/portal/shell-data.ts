import getDb, { isDatabaseConfigured } from '@/lib/db/client';
import { requireDropshipperAccount } from '@/lib/auth/seller-guard';
import {
  countCandidateStatusSummary,
  type CandidateStatusCounts,
} from '@/modules/catalog/candidates/queries';
import {
  findConnectionBySellerAndProvider,
  findProviderByCode,
} from '@/modules/suppliers/repository';
import type { ConnectionSummary } from '@/components/portal/PortalSidebar';

export type PortalShellData = {
  connectionSummary: ConnectionSummary;
  sourcingCounts: CandidateStatusCounts | null;
};

const NO_DATA: PortalShellData = {
  connectionSummary: null,
  sourcingCounts: null,
};

/**
 * Best-effort enrichment for the shared portal shell (rail badges, footer
 * connection health) - rendered on every portal page regardless of role, so
 * it must never throw. `requireDropshipperAccount` throws for every
 * non-dropshipper role (admin, catalogue_reviewer, viewer, ...), which have
 * no seller account at all; that, an unconfigured database, and any other
 * read failure all fall back to `NO_DATA` rather than breaking navigation -
 * the shell simply renders without badges/footer detail, never a fabricated
 * or stale one.
 */
export async function resolvePortalShellData(): Promise<PortalShellData> {
  if (!isDatabaseConfigured()) return NO_DATA;

  try {
    const { sellerAccount } = await requireDropshipperAccount();
    const db = getDb();
    const provider = await findProviderByCode(db, 'CJ_DROPSHIPPING');
    const connection =
      provider === null
        ? null
        : await findConnectionBySellerAndProvider(
            db,
            sellerAccount.id,
            provider.id,
          );

    const sourcingCounts = await countCandidateStatusSummary(sellerAccount.id);

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
  } catch {
    return NO_DATA;
  }
}
