import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  default: () => ({}),
  isDatabaseConfigured: () => true,
}));

vi.mock('@/modules/suppliers/repository', () => ({
  findSellerAccountByIdentityId: vi.fn(),
}));

vi.mock('./session', () => ({
  getSession: vi.fn(),
}));

// eslint-disable-next-line import/first
import type { SellerAccountRow } from '@/lib/db/schema';
// eslint-disable-next-line import/first
import { findSellerAccountByIdentityId } from '@/modules/suppliers/repository';
// eslint-disable-next-line import/first
import { getSession } from './session';
// eslint-disable-next-line import/first
import { PermissionError } from './permissions';
// eslint-disable-next-line import/first
import { requireDropshipperAccount } from './seller-guard';

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const SESSION = {
  userId: 'dev-user',
  displayName: 'Development user',
  role: 'seller_manager' as const,
  sellerId: 'seller-001',
};

function account(overrides: Partial<SellerAccountRow>): SellerAccountRow {
  return {
    id: 'seller-account-1',
    identityId: 'dev-user',
    businessModel: 'DROPSHIPPER',
    verificationState: 'VERIFIED',
    accountState: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('requireDropshipperAccount', () => {
  beforeEach(() => {
    asMock(getSession).mockReset().mockResolvedValue(SESSION);
    asMock(findSellerAccountByIdentityId).mockReset();
  });

  it('resolves for an active, verified Dropshipper account', async () => {
    asMock(findSellerAccountByIdentityId).mockResolvedValue(account({}));

    const result = await requireDropshipperAccount();

    expect(result.sellerAccount.id).toBe('seller-account-1');
  });

  it('rejects when no seller account exists for the identity', async () => {
    asMock(findSellerAccountByIdentityId).mockResolvedValue(null);

    await expect(requireDropshipperAccount()).rejects.toThrow(PermissionError);
  });

  it('rejects a Retailer account', async () => {
    asMock(findSellerAccountByIdentityId).mockResolvedValue(
      account({ businessModel: 'RETAILER' }),
    );

    await expect(requireDropshipperAccount()).rejects.toThrow(PermissionError);
  });

  it('rejects a not-yet-verified account', async () => {
    asMock(findSellerAccountByIdentityId).mockResolvedValue(
      account({ verificationState: 'PENDING' }),
    );

    await expect(requireDropshipperAccount()).rejects.toThrow(PermissionError);
  });

  it('rejects a rejected-verification account', async () => {
    asMock(findSellerAccountByIdentityId).mockResolvedValue(
      account({ verificationState: 'REJECTED' }),
    );

    await expect(requireDropshipperAccount()).rejects.toThrow(PermissionError);
  });

  it('rejects a suspended account', async () => {
    asMock(findSellerAccountByIdentityId).mockResolvedValue(
      account({ accountState: 'SUSPENDED' }),
    );

    await expect(requireDropshipperAccount()).rejects.toThrow(PermissionError);
  });

  it('rejects a closed account', async () => {
    asMock(findSellerAccountByIdentityId).mockResolvedValue(
      account({ accountState: 'CLOSED' }),
    );

    await expect(requireDropshipperAccount()).rejects.toThrow(PermissionError);
  });
});
