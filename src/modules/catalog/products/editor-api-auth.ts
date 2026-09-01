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

/**
 * The header a session-authenticated caller must send, and the reason this
 * whole second credential exists.
 *
 * Server Actions get CSRF protection from Next.js itself, which verifies the
 * request origin before an action runs. A Route Handler gets none of that:
 * a cookie is attached by the browser to ANY cross-site POST, so a
 * cookie-authenticated route with no origin check is a CSRF hole that lets
 * any page on the internet write to a logged-in seller's catalogue.
 *
 * Two guards, either of which is sufficient, both required:
 *
 * - **This custom header.** A cross-site HTML form cannot set one, and a
 *   cross-origin `fetch` that sets one triggers a CORS preflight this app
 *   never answers permissively - so the browser refuses the request before
 *   it arrives. A non-browser client (the automation's Python/HTTP calls)
 *   sets it trivially.
 * - **`Sec-Fetch-Site`.** Browsers send this on their own and it cannot be
 *   forged by page script. `cross-site` and `same-site` are refused;
 *   `same-origin` and `none` (a typed URL) pass, and an absent header - a
 *   non-browser client - passes because no browser omits it.
 */
export const EDITOR_API_CLIENT_HEADER = 'x-sals3-editor-api';

function isNotCrossSite(secFetchSite: string | null): boolean {
  if (secFetchSite === null) return true;

  return secFetchSite === 'same-origin' || secFetchSite === 'none';
}

/**
 * Who is calling an internal product-editor route, and on whose authority.
 *
 * `secret` is the deployment-wide credential: it carries no tenant of its
 * own, so a route resolves identity from the resource it was handed (see
 * `resolveProductActor`).
 *
 * `session` is a real logged-in seller's cookie - the same credential the
 * browser editor's Server Actions use, which is why this needs no
 * environment variable to work in a deployment that has none. It carries
 * its OWN tenant, and a route MUST use it rather than the resource's:
 * resolving the resource's actor here would let any logged-in seller write
 * to another tenant's product by naming its id. `resolveApiActor` is the
 * single place that decision is made, so no individual route can get it
 * wrong.
 */
export type EditorApiCaller =
  | { via: 'secret' }
  | { via: 'session'; sellerAccountId: string; actorId: string };

/**
 * Authorize a request by secret first, then by session cookie.
 *
 * The session path enforces exactly the gates every editorial Server Action
 * enforces, in the same order, and nothing more permissive:
 * a Better Auth session that is email-verified and 2FA-enrolled (the two
 * `getSession` itself redirects on), the `product:edit` permission for the
 * session's `PortalRole`, and ADR-006's `DROPSHIPPER` business-model rule.
 * A caller who passes all of them has precisely the authority their own
 * browser tab already has - no elevation, and no new trust boundary.
 *
 * Returns `null` for "not authorized", with no distinction between a bad
 * secret, a missing cookie, a failed CSRF guard and an insufficient role -
 * the same reason every other refusal here is undifferentiated.
 */
export async function authorizeEditorApiRequest(request: {
  headers: { get(name: string): string | null };
}): Promise<EditorApiCaller | null> {
  if (isProductEditorApiAuthorized(request.headers.get('authorization'))) {
    return { via: 'secret' };
  }

  if (request.headers.get(EDITOR_API_CLIENT_HEADER) === null) return null;
  if (!isNotCrossSite(request.headers.get('sec-fetch-site'))) return null;

  const { getRawAuthSession } = await import('@/lib/auth/session');
  const data = await getRawAuthSession();

  if (data === null) return null;

  const user = data.user as {
    id: string;
    emailVerified?: boolean;
    portalRole?: unknown;
    twoFactorEnabled?: boolean;
  };

  // The same two conditions `getSession` redirects to `/login` and
  // `/setup-2fa` for. A route handler cannot redirect a non-browser client,
  // so they are refusals here rather than navigations.
  if (user.emailVerified !== true) return null;
  if (user.twoFactorEnabled !== true) return null;

  const [{ can, PORTAL_ROLES }, { default: readSellerAccountForIdentity }] =
    await Promise.all([
      import('@/lib/auth/permissions'),
      import('@/lib/auth/seller-account'),
    ]);

  const role =
    PORTAL_ROLES.find((allowed) => allowed === user.portalRole) ?? 'viewer';

  if (!can(role, 'product:edit')) return null;

  const sellerAccount = await readSellerAccountForIdentity(user.id);

  if (sellerAccount === null) return null;
  if (sellerAccount.accountState !== 'ACTIVE') return null;
  if (sellerAccount.verificationState !== 'VERIFIED') return null;
  // ADR-006: a supplier-backed catalogue record is a Dropshipper capability,
  // the same check every editorial Server Action makes.
  if (sellerAccount.businessModel !== 'DROPSHIPPER') return null;

  return {
    via: 'session',
    sellerAccountId: sellerAccount.id,
    actorId: user.id,
  };
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

/**
 * The actor a route should write as, given who is calling.
 *
 * The whole point of this function is that the choice is made ONCE. A
 * `session` caller writes as themselves and never as the product's own
 * steward - using the resource's actor for a session caller would be a
 * cross-tenant write, and it is the single mistake this API could make that
 * a domain function would not catch, because the domain function only ever
 * checks that the `sellerAccountId` it was handed matches the product.
 *
 * `productVersion` still comes from the row either way: it is a
 * compare-and-set token, not an authority.
 */
export async function resolveApiActor(
  caller: EditorApiCaller,
  productId: string,
): Promise<ProductActor | null> {
  if (caller.via === 'secret') return resolveProductActor(productId);

  const product = await findProductById(getDb(), productId);

  if (product === null) return null;

  return {
    sellerAccountId: caller.sellerAccountId,
    actorId: caller.actorId,
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

/**
 * The candidate-scoped counterpart to `resolveApiActor`, for the two
 * draft-creation routes that carry no `productId` yet.
 *
 * A `session` caller writes as themselves; `createProductDraftFromCandidate`
 * and `captureCandidateEvidence` then refuse a candidate that is not theirs
 * (`findCandidateSourceForSeller` folds the tenant into the same predicate
 * that finds the row), so a wrong candidate id costs a refusal rather than a
 * cross-tenant draft or a CJ-point spend against someone else's connection.
 */
export async function resolveApiCandidateActor(
  caller: EditorApiCaller,
  candidateId: string,
): Promise<CandidateActor | null> {
  if (caller.via === 'secret') return resolveCandidateActor(candidateId);

  return {
    sellerAccountId: caller.sellerAccountId,
    actorId: caller.actorId,
  };
}
