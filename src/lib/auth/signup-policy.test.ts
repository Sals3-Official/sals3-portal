import { describe, expect, it } from 'vitest';
import {
  buildInitialSellerAccount,
  PUBLIC_SIGNUP_PORTAL_ROLE,
} from './signup-policy';

describe('public signup policy', () => {
  it('grants new public signups active seller-manager access after auth setup', () => {
    expect(PUBLIC_SIGNUP_PORTAL_ROLE).toBe('seller_manager');
    expect(
      buildInitialSellerAccount({
        id: 'user-123',
        registrationBusinessModel: 'DROPSHIPPER',
      }),
    ).toEqual({
      identityId: 'user-123',
      businessModel: 'DROPSHIPPER',
      verificationState: 'VERIFIED',
      accountState: 'ACTIVE',
    });
  });

  it('ignores non-seller auth users', () => {
    expect(
      buildInitialSellerAccount({
        id: 'user-123',
        registrationBusinessModel: 'ADMIN',
      }),
    ).toBeNull();
  });
});
