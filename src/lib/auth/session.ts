import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { SellerAccountRow } from '@/lib/db/schema';
import { SALS3_OFFICIAL_IDENTITY_ID } from './identity';
import {
  can,
  PermissionError,
  PORTAL_ROLES,
  type PortalPermission,
  type PortalRole,
} from './permissions';
import { resolvePortalEntryRedirect } from './redirect';

/**
 * Session gate. The production path always reads Better Auth on the server and
 * then applies portal-specific account state before any Seller Center page or
 * action can proceed.
 */

export type PortalSession = {
  userId: string;
  displayName: string;
  role: PortalRole;
  sellerId: string;
  sellerBusinessModel: SellerAccountRow['businessModel'] | null;
};

const DEV_FALLBACK_ROLE: PortalRole = 'seller_manager';
const SELLER_ROLES = new Set<PortalRole>([
  'seller_manager',
  'seller_staff',
  'viewer',
]);

function readDevRole(): PortalRole {
  const raw = process.env.PORTAL_DEV_ROLE;

  return PORTAL_ROLES.find((role) => role === raw) ?? DEV_FALLBACK_ROLE;
}

function readTestBypassSession(): PortalSession | null {
  if (
    process.env.NODE_ENV === 'production' ||
    process.env.PORTAL_TEST_AUTH_BYPASS !== '1'
  ) {
    return null;
  }

  return {
    userId: SALS3_OFFICIAL_IDENTITY_ID,
    displayName: 'Development user',
    role: readDevRole(),
    sellerId: 'seller-001',
    sellerBusinessModel: 'DROPSHIPPER',
  };
}

export type PortalAccessState = {
  hasSession: boolean;
  hasPendingTwoFactor: boolean;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  sellerApproved: boolean;
};

type BetterAuthUser = {
  id: string;
  name: string;
  emailVerified: boolean;
  portalRole?: PortalRole;
  twoFactorEnabled?: boolean;
};

const TWO_FACTOR_COOKIE_NAMES = [
  'better-auth.two_factor',
  '__Secure-better-auth.two_factor',
  'better-auth-two_factor',
  '__Secure-better-auth-two_factor',
];

export async function getRawAuthSession() {
  // `headers()` first, on purpose. It is the dynamic signal that makes Next
  // abandon a prerender, and it must land before anything touches the
  // database — otherwise `next build` fails collecting page data for every
  // portal route in an environment with no DATABASE_URL.
  const requestHeaders = await headers();
  const { default: getAuth } = await import('./server');

  return getAuth().api.getSession({ headers: requestHeaders });
}

async function hasPendingTwoFactorChallenge(): Promise<boolean> {
  const requestHeaders = await headers();
  const cookieHeader = requestHeaders.get('cookie');

  if (cookieHeader === null) return false;

  return TWO_FACTOR_COOKIE_NAMES.some((name) =>
    cookieHeader.includes(`${name}=`),
  );
}

function coercePortalRole(role: unknown): PortalRole {
  return PORTAL_ROLES.find((allowedRole) => allowedRole === role) ?? 'viewer';
}

async function resolvePortalSession(
  user: BetterAuthUser,
): Promise<PortalSession> {
  const [{ default: getDb }, { findSellerAccountByIdentityId }] =
    await Promise.all([
      import('@/lib/db/client'),
      import('@/modules/suppliers/repository'),
    ]);
  const role = coercePortalRole(user.portalRole);
  const sellerAccount = await findSellerAccountByIdentityId(getDb(), user.id);

  if (SELLER_ROLES.has(role)) {
    if (
      sellerAccount === null ||
      sellerAccount.accountState !== 'ACTIVE' ||
      sellerAccount.verificationState !== 'VERIFIED'
    ) {
      redirect('/auth/pending');
    }
  }

  return {
    userId: user.id,
    displayName: user.name,
    role,
    sellerId: sellerAccount?.id ?? 'system',
    sellerBusinessModel: sellerAccount?.businessModel ?? null,
  };
}

export async function getPortalAccessState(): Promise<PortalAccessState> {
  const testSession = readTestBypassSession();

  if (testSession !== null) {
    return {
      hasSession: true,
      hasPendingTwoFactor: false,
      emailVerified: true,
      twoFactorEnabled: true,
      sellerApproved: true,
    };
  }

  const [data, hasPendingTwoFactor] = await Promise.all([
    getRawAuthSession(),
    hasPendingTwoFactorChallenge(),
  ]);

  if (data === null) {
    return {
      hasSession: false,
      hasPendingTwoFactor,
      emailVerified: false,
      twoFactorEnabled: false,
      sellerApproved: false,
    };
  }

  const user = data.user as BetterAuthUser;
  const role = coercePortalRole(user.portalRole);
  const [{ default: getDb }, { findSellerAccountByIdentityId }] =
    await Promise.all([
      import('@/lib/db/client'),
      import('@/modules/suppliers/repository'),
    ]);
  const sellerAccount = await findSellerAccountByIdentityId(getDb(), user.id);
  const sellerApproved =
    !SELLER_ROLES.has(role) ||
    (sellerAccount !== null &&
      sellerAccount.accountState === 'ACTIVE' &&
      sellerAccount.verificationState === 'VERIFIED');

  return {
    hasSession: true,
    hasPendingTwoFactor: false,
    emailVerified: user.emailVerified,
    twoFactorEnabled: user.twoFactorEnabled === true,
    sellerApproved,
  };
}

export async function getPortalEntryRedirect(
  intended: string | null | undefined,
): Promise<string> {
  return resolvePortalEntryRedirect(await getPortalAccessState(), intended);
}

export async function getSession(): Promise<PortalSession> {
  const testSession = readTestBypassSession();

  if (testSession !== null) return testSession;

  const data = await getRawAuthSession();

  if (data === null) {
    redirect('/login');
  }

  const user = data.user as BetterAuthUser;

  if (!user.emailVerified) {
    redirect('/login');
  }

  if (user.twoFactorEnabled !== true) {
    redirect('/setup-2fa');
  }

  return resolvePortalSession(user);
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
