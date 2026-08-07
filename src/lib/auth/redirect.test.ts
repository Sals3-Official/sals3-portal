import { describe, expect, it } from 'vitest';
import { redirectAfterPortalState, safeAuthRedirect } from './redirect';

describe('auth redirects', () => {
  it('allows only portal-local destinations', () => {
    expect(safeAuthRedirect('/overview')).toBe('/overview');
    expect(safeAuthRedirect('/products/abc?tab=review')).toBe(
      '/products/abc?tab=review',
    );
    expect(safeAuthRedirect('https://example.com/overview')).toBe('/overview');
    expect(safeAuthRedirect('//example.com/overview')).toBe('/overview');
    expect(safeAuthRedirect('/api/auth/session')).toBe('/overview');
  });

  it('orders portal entry checks before the intended route', () => {
    expect(
      redirectAfterPortalState({
        isVerifiedEmail: false,
        isTwoFactorEnabled: true,
        isSellerApproved: true,
        intended: '/orders',
      }),
    ).toBe('/login');

    expect(
      redirectAfterPortalState({
        isVerifiedEmail: true,
        isTwoFactorEnabled: true,
        isSellerApproved: false,
        intended: '/orders',
      }),
    ).toBe('/auth/pending');

    expect(
      redirectAfterPortalState({
        isVerifiedEmail: true,
        isTwoFactorEnabled: false,
        isSellerApproved: true,
        intended: '/orders',
      }),
    ).toBe('/setup-2fa');
  });
});
