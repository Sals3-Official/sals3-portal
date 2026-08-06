import { desc, eq } from 'drizzle-orm';
import getDb from '@/lib/db/client';
import { supplierCandidates } from '@/lib/db/schema';

/**
 * Read side of the candidate shortlist. Kept separate from `repository.ts`
 * (which serves the write use case) so a read path can never reach a mutation
 * helper by accident.
 */

export type ShortlistedCandidate = {
  id: string;
  externalProductId: string;
  intendedMarketCodes: string[];
  shortlistState: 'SHORTLISTED' | 'PREFLIGHT_PENDING';
  createdAt: Date;
  createdBy: string;
};

/**
 * Scoped to one seller so a future multi-seller portal cannot leak another
 * seller's shortlist (spec section 17: entity keys and authorization checks
 * must carry seller/tenant scope). `limit` is bounded — never an unbounded
 * scan.
 */
export default async function listShortlistedCandidates(
  sellerId: string,
  limit = 50,
): Promise<ShortlistedCandidate[]> {
  const rows = await getDb()
    .select({
      id: supplierCandidates.id,
      externalProductId: supplierCandidates.externalProductId,
      intendedMarketCodes: supplierCandidates.intendedMarketCodes,
      shortlistState: supplierCandidates.shortlistState,
      createdAt: supplierCandidates.createdAt,
      createdBy: supplierCandidates.createdBy,
    })
    .from(supplierCandidates)
    .where(eq(supplierCandidates.intendedSellerId, sellerId))
    .orderBy(desc(supplierCandidates.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200));

  return rows;
}
