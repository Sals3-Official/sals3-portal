import { and, desc, eq } from 'drizzle-orm';
import type { Executor } from '@/modules/catalog/candidates/repository';
import {
  sellerMarketProfiles,
  type SellerMarketProfileRow,
  type SellerMarketProfileStatus,
} from '@/lib/db/schema';

/**
 * Data access for a seller's own market profile.
 *
 * Every function takes the authenticated `sellerAccountId` and folds it into
 * the `WHERE` clause — including the read-one-by-id path, which is the
 * classic IDOR shape. Nothing here filters in JavaScript after fetching, and
 * nothing accepts an owner id that arrived from a browser.
 *
 * The mutations are compare-and-set: they name the status and version the
 * caller believes it is acting on, so a stale tab or a double submit matches
 * zero rows and returns `null` rather than clobbering a transition it never
 * saw. `null` therefore means "not yours, not there, or not in that state"
 * — one indistinguishable answer, so a caller cannot probe for the existence
 * of another tenant's profile.
 *
 * Like `modules/pricing/repository.ts`, this module never opens its own
 * transaction; the caller passes an `Executor` so authorization, state
 * change, and audit share one.
 */

export async function listProfilesForSeller(
  executor: Executor,
  sellerAccountId: string,
): Promise<SellerMarketProfileRow[]> {
  return executor
    .select()
    .from(sellerMarketProfiles)
    .where(eq(sellerMarketProfiles.sellerAccountId, sellerAccountId))
    .orderBy(desc(sellerMarketProfiles.createdAt));
}

/** Read one profile, scoped. Returns `null` for another tenant's id. */
export async function findProfileForSeller(
  executor: Executor,
  profileId: string,
  sellerAccountId: string,
): Promise<SellerMarketProfileRow | null> {
  const rows = await executor
    .select()
    .from(sellerMarketProfiles)
    .where(
      and(
        eq(sellerMarketProfiles.id, profileId),
        eq(sellerMarketProfiles.sellerAccountId, sellerAccountId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export async function createDraftProfile(
  executor: Executor,
  input: {
    sellerAccountId: string;
    destinationCountryCode: string;
    capabilityVersion: string;
    source: string;
    reason: string;
    actorId: string;
  },
): Promise<SellerMarketProfileRow> {
  const [row] = await executor
    .insert(sellerMarketProfiles)
    .values({
      ...input,
      // Absent, not guessed: no per-destination currency, locale, or time
      // zone is platform-authorized yet. See the schema doc comment.
      sellingCurrencyCode: null,
      locale: null,
      timeZone: null,
      status: 'DRAFT',
      version: 1,
    })
    .returning();

  return row;
}

/**
 * Moves a profile between lifecycle states, scoped to the seller and gated
 * on the exact state the caller read. Returns the updated row, or `null`
 * when the compare-and-set matched nothing.
 */
export async function transitionProfileForSeller(
  executor: Executor,
  input: {
    profileId: string;
    sellerAccountId: string;
    expectedStatus: SellerMarketProfileStatus;
    expectedVersion: number;
    nextStatus: SellerMarketProfileStatus;
    reason: string;
    actorId: string;
  },
): Promise<SellerMarketProfileRow | null> {
  const now = new Date();

  const [row] = await executor
    .update(sellerMarketProfiles)
    .set({
      status: input.nextStatus,
      version: input.expectedVersion + 1,
      reason: input.reason,
      actorId: input.actorId,
      updatedAt: now,
      ...(input.nextStatus === 'ACTIVE' ? { activatedAt: now } : {}),
      ...(input.nextStatus === 'SUSPENDED' ? { suspendedAt: now } : {}),
    })
    .where(
      and(
        eq(sellerMarketProfiles.id, input.profileId),
        eq(sellerMarketProfiles.sellerAccountId, input.sellerAccountId),
        eq(sellerMarketProfiles.status, input.expectedStatus),
        eq(sellerMarketProfiles.version, input.expectedVersion),
      ),
    )
    .returning();

  return row ?? null;
}
