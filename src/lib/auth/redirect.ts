const DEFAULT_AFTER_LOGIN = '/overview';

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

export function redirectAfterPortalState(params?: {
  isVerifiedEmail?: boolean;
  isTwoFactorEnabled?: boolean;
  isSellerApproved?: boolean;
  intended?: string | null;
}): string {
  if (params?.isVerifiedEmail === false) return '/login';
  if (params?.isSellerApproved === false) return '/auth/pending';
  if (params?.isTwoFactorEnabled === false) return '/setup-2fa';

  return safeAuthRedirect(params?.intended);
}
