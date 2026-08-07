import getDb from '@/lib/db/client';
import { findSellerAccountByIdentityId } from '@/modules/suppliers/repository';
import type { SellerAccountRow } from '@/lib/db/schema';
import { PermissionError } from './permissions';
import { getSession, type PortalSession } from './session';

/**
 * Seller-account authorization (ADR-006/008), layered on top of the
 * existing portal role session rather than replacing it - this repository
 * has no real seller identity provider yet (`getSession()` is still the
 * `PORTAL_DEV_ROLE` placeholder documented in `session.ts`). `identityId`
 * is that same dev session's `userId` ('dev-user') - a labelled placeholder
 * in the same spirit, not a new one. When real seller sign-in lands, only
 * this function's body changes; every `requireDropshipperAccount()` caller
 * stays the same.
 */
export async function requireAuthenticatedSellerSession(): Promise<{
  session: PortalSession;
  identityId: string;
}> {
  const session = await getSession();

  return { session, identityId: session.userId };
}

export type DropshipperContext = {
  session: PortalSession;
  sellerAccount: SellerAccountRow;
};

export async function requireDropshipperAccount(): Promise<DropshipperContext> {
  const { session, identityId } = await requireAuthenticatedSellerSession();
  const account = await findSellerAccountByIdentityId(getDb(), identityId);

  if (
    account === null ||
    account.accountState !== 'ACTIVE' ||
    account.verificationState !== 'VERIFIED' ||
    account.businessModel !== 'DROPSHIPPER'
  ) {
    throw new PermissionError();
  }

  return { session, sellerAccount: account };
}
