import { createHash, timingSafeEqual } from 'crypto';
import { eq } from 'drizzle-orm';
import getDb from '@/lib/db/client';
import {
  sellerAccounts,
  supplierCandidates,
  supplierConnections,
} from '@/lib/db/schema';
import {
  findOpenDraftRevision,
  findProductById,
  findRevisionOfProduct,
} from './repository';

/**
 * Authentication for the internal product-editor routes (`/api/internal/
 * products/**`): a dedicated server-only secret (`PRODUCT_EDITOR_API_SECRET`),
 * compared in constant time. Same shape as
 * `modules/catalog/discovery/control-auth.ts` - both values hashed to a
 * fixed width before comparison so a length mismatch can neither throw nor
 * leak timing, fails closed when the secret is unset.
 *
 * A separate secret from `DISCOVERY_CONTROL_SECRET` on purpose: this one
 * can write to a seller's editorial record (title, category, description,
 * pricing, publish state), the discovery one only pauses/resumes a
 * background job. Rotating one must never affect the other.
 */
export function isProductEditorApiAuthorized(
  authorizationHeader: string | null,
): boolean {
  const secret = process.env.PRODUCT_EDITOR_API_SECRET;

  if (secret === undefined || secret.trim() === '') return false;
  if (authorizationHeader === null) return false;

  const expected = createHash('sha256').update(`Bearer ${secret}`).digest();
  const provided = createHash('sha256').update(authorizationHeader).digest();

  return timingSafeEqual(expected, provided);
}

export type ProductActor = {
  sellerAccountId: string;
  actorId: string;
  productVersion: number;
};

/**
 * Resolves *who* an internal-API write is made as, from the product alone -
 * never a caller-supplied id, and never the `dev-user`/`SALS3_OFFICIAL_
 * IDENTITY_ID` bootstrap identity (see `src/lib/auth/identity.ts`: reusing
 * that shortcut once already took the live storefront down when its
 * connection was purged, and its own doc comment says plainly that no
 * request path may read it again).
 *
 * `products.stewardSellerAccountId` is the same field every editorial
 * Server Action's session-derived `sellerAccountId` is ultimately checked
 * against (`ownsProduct`, `findProductForSteward`) - reading it directly
 * here, then resolving that account's own `identityId`, produces the exact
 * identity a real logged-in session for this product's owner would have
 * carried. The domain functions this feeds
 * (`saveCategoryAttributes`, `publishProduct`, ...) still independently
 * re-verify `stewardSellerAccountId` against `productId` inside their own
 * transaction - this resolution does not weaken that check, it only
 * supplies the value a cookie session would otherwise have provided.
 *
 * Returns `null` for a product id that does not exist, matching the
 * "not_found" shape the domain functions themselves already use rather than
 * throwing - a route handler should read `null` as 404, not 500.
 */
export async function resolveProductActor(
  productId: string,
): Promise<ProductActor | null> {
  const db = getDb();

  const product = await findProductById(db, productId);
  if (product === null) return null;

  const [sellerAccount] = await db
    .select({ identityId: sellerAccounts.identityId })
    .from(sellerAccounts)
    .where(eq(sellerAccounts.id, product.stewardSellerAccountId))
    .limit(1);

  if (sellerAccount === undefined) return null;

  return {
    sellerAccountId: product.stewardSellerAccountId,
    actorId: sellerAccount.identityId,
    productVersion: product.version,
  };
}

export type ProductRevisionPointer = {
  revisionId: string;
  revisionVersion: number;
};

/**
 * The revision a caller who has not separately read the editor would be
 * looking at - same resolution order the editor page itself follows: an
 * open `DRAFT` revision if one exists (an edit already in progress),
 * otherwise the product's current revision (`products.current_revision_id`)
 * - which on a never-yet-published product is its very first revision, and
 * on a Live product with nothing pending is the published one. Passing that
 * revision's id to `saveDescriptionDocument`/`saveMetaDescription` is
 * exactly what the browser does before a domain function ever runs; those
 * functions decide whether to fork a fresh draft from it, this only
 * supplies the id and version a page load would otherwise have provided.
 *
 * `null` when the product has no revision at all (should not happen for a
 * product created through `createProductDraftAction`'s normal path, but is
 * not asserted away here - a route handler should read it as a real
 * refusal, not a thrown 500).
 */
export async function resolveProductRevision(
  productId: string,
): Promise<ProductRevisionPointer | null> {
  const db = getDb();

  const openDraft = await findOpenDraftRevision(db, productId);
  if (openDraft !== null) {
    return { revisionId: openDraft.id, revisionVersion: openDraft.version };
  }

  const product = await findProductById(db, productId);
  if (product === null || product.currentRevisionId === null) return null;

  const current = await findRevisionOfProduct(db, {
    revisionId: product.currentRevisionId,
    productId,
  });
  if (current === null) return null;

  return { revisionId: current.id, revisionVersion: current.version };
}

export type CandidateActor = {
  sellerAccountId: string;
  actorId: string;
};

/**
 * Resolves *who* an internal-API draft-creation write is made as, from the
 * candidate alone - the one case in this module where there is no product
 * yet to read `stewardSellerAccountId` off (`createProductDraftAction` and
 * `bulkCreateProductDraftsAction` both take only a `candidateId`, never a
 * `productId`).
 *
 * Same join `findCandidateSourceForSeller` uses to *verify* a caller-supplied
 * `sellerAccountId` against a candidate, run here to *derive* one instead:
 * `supplier_candidates.supplier_connection_id -> supplier_connections.
 * seller_account_id` is the same chain that answers "which seller may spend
 * this candidate's CJ points", so a secret-holder resolved through it lands
 * on the identical tenant a real session for this candidate's owner would
 * have carried. `createProductDraftFromCandidate` and
 * `captureCandidateEvidence` still independently re-check ownership inside
 * their own transaction - this resolution does not weaken that check, it
 * only supplies the value a cookie session would otherwise have provided.
 *
 * Returns `null` for a candidate id that does not exist or belongs to no
 * connection, matching this module's other resolvers: a route handler
 * should read `null` as 404 (in practice the domain function's own
 * `not_found` refusal, since a crafted id is otherwise indistinguishable
 * from one that never existed), not throw.
 */
export async function resolveCandidateActor(
  candidateId: string,
): Promise<CandidateActor | null> {
  const db = getDb();

  const [row] = await db
    .select({
      sellerAccountId: supplierConnections.sellerAccountId,
      identityId: sellerAccounts.identityId,
    })
    .from(supplierCandidates)
    .innerJoin(
      supplierConnections,
      eq(supplierConnections.id, supplierCandidates.supplierConnectionId),
    )
    .innerJoin(
      sellerAccounts,
      eq(sellerAccounts.id, supplierConnections.sellerAccountId),
    )
    .where(eq(supplierCandidates.id, candidateId))
    .limit(1);

  if (row === undefined) return null;

  return { sellerAccountId: row.sellerAccountId, actorId: row.identityId };
}
