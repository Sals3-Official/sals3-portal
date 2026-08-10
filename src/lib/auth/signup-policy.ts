import type { SellerAccountRow } from '@/lib/db/schema';

type SignupBusinessModel = SellerAccountRow['businessModel'];

type PublicSignupUser = {
  id: string;
  registrationBusinessModel?: unknown;
};

export const PUBLIC_SIGNUP_PORTAL_ROLE = 'seller_manager';

export type InitialSellerAccount = {
  identityId: string;
  businessModel: SignupBusinessModel;
  verificationState: 'VERIFIED';
  accountState: 'ACTIVE';
};

export function buildInitialSellerAccount(
  user: PublicSignupUser,
): InitialSellerAccount | null {
  if (
    user.registrationBusinessModel !== 'RETAILER' &&
    user.registrationBusinessModel !== 'DROPSHIPPER'
  ) {
    return null;
  }

  return {
    identityId: user.id,
    businessModel: user.registrationBusinessModel,
    verificationState: 'VERIFIED',
    accountState: 'ACTIVE',
  };
}
