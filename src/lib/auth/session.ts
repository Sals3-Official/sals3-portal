import { SALS3_OFFICIAL_IDENTITY_ID } from './identity';
import {
  can,
  PermissionError,
  PORTAL_ROLES,
  type PortalPermission,
  type PortalRole,
} from './permissions';

/**
 * Session gate — placeholder, and deliberately visible as one.
 *
 * This repository has no authentication system yet, so there is no verified
 * user to read. `getSession` returns a single development identity whose role
 * comes from the server-side `PORTAL_DEV_ROLE` variable, checked against the
 * role allow list. The variable has no `NEXT_PUBLIC_` prefix, so it never
 * reaches the browser.
 *
 * Do not treat this as authentication. When real sign-in lands, replace the
 * body of `getSession` with the verified session lookup; every caller of
 * `requirePermission` then becomes a real authorization check with no other
 * change. Until then the portal must not be exposed to untrusted users.
 */

export type PortalSession = {
  userId: string;
  displayName: string;
  role: PortalRole;
  sellerId: string;
};

const DEV_FALLBACK_ROLE: PortalRole = 'seller_manager';

function readDevRole(): PortalRole {
  const raw = process.env.PORTAL_DEV_ROLE;

  return PORTAL_ROLES.find((role) => role === raw) ?? DEV_FALLBACK_ROLE;
}

export async function getSession(): Promise<PortalSession> {
  return {
    userId: SALS3_OFFICIAL_IDENTITY_ID,
    displayName: 'Development user',
    role: readDevRole(),
    sellerId: 'seller-001',
  };
}

/**
 * Server-side authorization check. Throws `PermissionError` when the session
 * role does not hold the permission. Call this first in every server action and
 * route handler that reads or writes product data.
 */
export async function requirePermission(
  permission: PortalPermission,
): Promise<PortalSession> {
  const session = await getSession();

  if (!can(session.role, permission)) {
    throw new PermissionError();
  }

  return session;
}

/**
 * Resource-ownership check that blocks insecure direct object reference. A
 * seller role may only touch its own products; reviewers and admins may touch
 * any product.
 */
export function ownsProduct(
  session: PortalSession,
  productSellerId: string,
): boolean {
  if (session.role === 'admin' || session.role === 'catalogue_reviewer') {
    return true;
  }

  return session.sellerId === productSellerId;
}
