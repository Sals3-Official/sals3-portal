export const DEFAULT_AFTER_LOGIN = '/overview';

const ALLOWED_REDIRECTS = new Set([
  '/overview',
  '/orders',
  '/inventory',
  '/finances',
  '/payouts',
  '/market-rules',
  '/supplier-apps',
  '/products',
  '/listings',
]);

export function safeAuthRedirect(input: string | null | undefined): string {
  if (input === null || input === undefined || input.trim() === '') {
    return DEFAULT_AFTER_LOGIN;
  }

  if (!input.startsWith('/') || input.startsWith('//')) {
    return DEFAULT_AFTER_LOGIN;
  }

  try {
    const url = new URL(input, 'https://portal.sals3.local');
    const path = url.pathname;

    if (
      ALLOWED_REDIRECTS.has(path) ||
      path.startsWith('/products/') ||
      path.startsWith('/listings/')
    ) {
      return `${path}${url.search}`;
    }
  } catch {
    return DEFAULT_AFTER_LOGIN;
  }

  return DEFAULT_AFTER_LOGIN;
}

export type PortalEntryState = {
  hasSession: boolean;
  hasPendingTwoFactor?: boolean;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  sellerApproved: boolean;
};

export function authStepRedirect(
  pathname: '/login' | '/setup-2fa' | '/two-factor',
  intended: string | null | undefined,
): string {
  const destination = new URL(pathname, 'https://portal.sals3.local');
  destination.searchParams.set('next', safeAuthRedirect(intended));

  return `${destination.pathname}${destination.search}`;
}

export function continueAuthRedirect(
  intended: string | null | undefined,
): string {
  const destination = new URL('/auth/continue', 'https://portal.sals3.local');
  destination.searchParams.set('next', safeAuthRedirect(intended));

  return `${destination.pathname}${destination.search}`;
}

export function resolvePortalEntryRedirect(
  state: PortalEntryState,
  intended: string | null | undefined,
): string {
  if (!state.hasSession) {
    return state.hasPendingTwoFactor === true
      ? authStepRedirect('/two-factor', intended)
      : authStepRedirect('/login', intended);
  }

  if (!state.emailVerified) return authStepRedirect('/login', intended);
  if (!state.twoFactorEnabled) return authStepRedirect('/setup-2fa', intended);
  if (!state.sellerApproved) return '/auth/pending';

  return safeAuthRedirect(intended);
}

export function redirectAfterPortalState(params?: {
  isVerifiedEmail?: boolean;
  isTwoFactorEnabled?: boolean;
  isSellerApproved?: boolean;
  intended?: string | null;
}): string {
  return resolvePortalEntryRedirect(
    {
      hasSession: true,
      emailVerified: params?.isVerifiedEmail !== false,
      twoFactorEnabled: params?.isTwoFactorEnabled !== false,
      sellerApproved: params?.isSellerApproved !== false,
    },
    params?.intended,
  );
}
