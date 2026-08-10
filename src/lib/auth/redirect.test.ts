import { describe, expect, it } from 'vitest';
import {
  authStepRedirect,
  continueAuthRedirect,
  redirectAfterPortalState,
  resolvePortalEntryRedirect,
  safeAuthRedirect,
} from './redirect';

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
    ).toBe('/login?next=%2Forders');

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
    ).toBe('/setup-2fa?next=%2Forders');
  });

  it('routes pending two-factor challenges before a fresh login', () => {
    expect(
      resolvePortalEntryRedirect(
        {
          hasSession: false,
          hasPendingTwoFactor: true,
          emailVerified: false,
          twoFactorEnabled: false,
          sellerApproved: false,
        },
        '/products/qualified/ready',
      ),
    ).toBe('/two-factor?next=%2Fproducts%2Fqualified%2Fready');

    expect(
      resolvePortalEntryRedirect(
        {
          hasSession: false,
          emailVerified: false,
          twoFactorEnabled: false,
          sellerApproved: false,
        },
        '/orders',
      ),
    ).toBe('/login?next=%2Forders');
  });

  it('builds auth step and continuation routes with sanitized next values', () => {
    expect(authStepRedirect('/setup-2fa', '/orders?filter=open')).toBe(
      '/setup-2fa?next=%2Forders%3Ffilter%3Dopen',
    );
    expect(continueAuthRedirect('/finances')).toBe(
      '/auth/continue?next=%2Ffinances',
    );
    expect(continueAuthRedirect('https://example.com')).toBe(
      '/auth/continue?next=%2Foverview',
    );
  });
});
