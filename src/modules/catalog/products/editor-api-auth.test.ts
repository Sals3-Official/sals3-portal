// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The security boundary of the internal product-editor API.
 *
 * Two credentials reach these routes and they are NOT interchangeable:
 *
 * - `PRODUCT_EDITOR_API_SECRET` is deployment-wide and carries no tenant, so
 *   a route resolves identity from the resource it was handed.
 * - A session cookie carries its own tenant, and a route must write as THAT
 *   tenant. Resolving the resource's own steward for a session caller would
 *   let any logged-in seller write to another seller's product by naming its
 *   id - the one escalation the domain functions cannot catch, because they
 *   only ever check that the `sellerAccountId` they were handed matches the
 *   product.
 *
 * The session path also has no Next.js CSRF protection (that is a Server
 * Action feature), so the custom-header and `Sec-Fetch-Site` guards are load
 * bearing rather than decorative: without them, any page on the internet
 * could POST to these routes with a logged-in seller's cookie attached.
 */

const SECRET = 'test-editor-api-secret';
const SELLER_ACCOUNT_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_SELLER_ACCOUNT_ID = '22222222-2222-2222-2222-222222222222';
const IDENTITY_ID = 'auth-user-id';
const PRODUCT_ID = '33333333-3333-3333-3333-333333333333';

const getRawAuthSession = vi.fn();
const readSellerAccountForIdentity = vi.fn();
const findProductById = vi.fn();

vi.mock('@/lib/auth/session', () => ({
  getRawAuthSession: () => getRawAuthSession(),
}));

vi.mock('@/lib/auth/seller-account', () => ({
  default: (identityId: string) => readSellerAccountForIdentity(identityId),
}));

vi.mock('@/lib/db/client', () => ({
  default: () => ({}),
  isDatabaseConfigured: () => true,
}));

vi.mock('./repository', () => ({
  findProductById: (_db: unknown, id: string) => findProductById(id),
  findOpenDraftRevision: vi.fn(),
  findRevisionOfProduct: vi.fn(),
}));

/** A verified, 2FA-enrolled, ACTIVE/VERIFIED DROPSHIPPER — the happy path. */
function signedInAsSeller(): void {
  getRawAuthSession.mockResolvedValue({
    user: {
      id: IDENTITY_ID,
      emailVerified: true,
      twoFactorEnabled: true,
      portalRole: 'seller_manager',
    },
  });
  readSellerAccountForIdentity.mockResolvedValue({
    id: SELLER_ACCOUNT_ID,
    identityId: IDENTITY_ID,
    accountState: 'ACTIVE',
    verificationState: 'VERIFIED',
    businessModel: 'DROPSHIPPER',
  });
}

function request(headers: Record<string, string>): {
  headers: { get(name: string): string | null };
} {
  const lower = new Map(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );

  return { headers: { get: (name) => lower.get(name.toLowerCase()) ?? null } };
}

describe('authorizeEditorApiRequest', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.PRODUCT_EDITOR_API_SECRET = SECRET;
    getRawAuthSession.mockReset();
    readSellerAccountForIdentity.mockReset();
    findProductById.mockReset();
  });

  afterEach(() => {
    delete process.env.PRODUCT_EDITOR_API_SECRET;
  });

  async function authorize(headers: Record<string, string>) {
    const { authorizeEditorApiRequest } = await import('./editor-api-auth');

    return authorizeEditorApiRequest(request(headers));
  }

  it('accepts the deployment secret, and never reads a session for it', async () => {
    const caller = await authorize({ authorization: `Bearer ${SECRET}` });

    expect(caller).toEqual({ via: 'secret' });
    expect(getRawAuthSession).not.toHaveBeenCalled();
  });

  it('refuses a wrong secret', async () => {
    expect(await authorize({ authorization: 'Bearer nope' })).toBeNull();
  });

  it('accepts a signed-in seller session and reports THEIR tenant', async () => {
    signedInAsSeller();

    expect(
      await authorize({
        'x-sals3-editor-api': '1',
        'sec-fetch-site': 'same-origin',
      }),
    ).toEqual({
      via: 'session',
      sellerAccountId: SELLER_ACCOUNT_ID,
      actorId: IDENTITY_ID,
    });
  });

  it('works with no secret configured at all — this is the point', async () => {
    // The deployment this was built for has no PRODUCT_EDITOR_API_SECRET set.
    // A session caller must still be able to authenticate, or the whole
    // cookie path is pointless.
    delete process.env.PRODUCT_EDITOR_API_SECRET;
    signedInAsSeller();

    expect(await authorize({ 'x-sals3-editor-api': '1' })).toEqual({
      via: 'session',
      sellerAccountId: SELLER_ACCOUNT_ID,
      actorId: IDENTITY_ID,
    });
  });

  describe('CSRF guards on the session path', () => {
    it('refuses a request with no custom header, even with a valid cookie', async () => {
      signedInAsSeller();

      // Exactly what a cross-site <form> POST looks like: the cookie rides
      // along, and the attacker cannot add a header.
      expect(await authorize({})).toBeNull();
      expect(await authorize({ 'sec-fetch-site': 'cross-site' })).toBeNull();
    });

    it.each(['cross-site', 'same-site'])(
      'refuses Sec-Fetch-Site: %s',
      async (site) => {
        signedInAsSeller();

        expect(
          await authorize({
            'x-sals3-editor-api': '1',
            'sec-fetch-site': site,
          }),
        ).toBeNull();
      },
    );

    it.each(['same-origin', 'none'])(
      'allows Sec-Fetch-Site: %s',
      async (site) => {
        signedInAsSeller();

        expect(
          await authorize({
            'x-sals3-editor-api': '1',
            'sec-fetch-site': site,
          }),
        ).not.toBeNull();
      },
    );

    it('allows an absent Sec-Fetch-Site — no browser omits it', async () => {
      signedInAsSeller();

      expect(await authorize({ 'x-sals3-editor-api': '1' })).not.toBeNull();
    });
  });

  describe('the session path enforces every gate a Server Action does', () => {
    const headers = {
      'x-sals3-editor-api': '1',
      'sec-fetch-site': 'same-origin',
    };

    it('refuses when there is no session', async () => {
      getRawAuthSession.mockResolvedValue(null);

      expect(await authorize(headers)).toBeNull();
    });

    it('refuses an unverified email', async () => {
      signedInAsSeller();
      getRawAuthSession.mockResolvedValue({
        user: {
          id: IDENTITY_ID,
          emailVerified: false,
          twoFactorEnabled: true,
          portalRole: 'seller_manager',
        },
      });

      expect(await authorize(headers)).toBeNull();
    });

    it('refuses an account without 2FA', async () => {
      signedInAsSeller();
      getRawAuthSession.mockResolvedValue({
        user: {
          id: IDENTITY_ID,
          emailVerified: true,
          twoFactorEnabled: false,
          portalRole: 'seller_manager',
        },
      });

      expect(await authorize(headers)).toBeNull();
    });

    it('refuses a role without product:edit', async () => {
      signedInAsSeller();
      getRawAuthSession.mockResolvedValue({
        user: {
          id: IDENTITY_ID,
          emailVerified: true,
          twoFactorEnabled: true,
          portalRole: 'viewer',
        },
      });

      expect(await authorize(headers)).toBeNull();
    });

    it('refuses an unknown portalRole rather than defaulting it open', async () => {
      signedInAsSeller();
      getRawAuthSession.mockResolvedValue({
        user: {
          id: IDENTITY_ID,
          emailVerified: true,
          twoFactorEnabled: true,
          portalRole: 'not-a-real-role',
        },
      });

      expect(await authorize(headers)).toBeNull();
    });

    it.each([
      ['accountState', { accountState: 'SUSPENDED' }],
      ['verificationState', { verificationState: 'PENDING' }],
      // ADR-006: a supplier-backed catalogue record is a Dropshipper
      // capability. A Retailer holding product:edit still may not.
      ['businessModel', { businessModel: 'RETAILER' }],
    ])('refuses on %s', async (_label, override) => {
      signedInAsSeller();
      readSellerAccountForIdentity.mockResolvedValue({
        id: SELLER_ACCOUNT_ID,
        identityId: IDENTITY_ID,
        accountState: 'ACTIVE',
        verificationState: 'VERIFIED',
        businessModel: 'DROPSHIPPER',
        ...override,
      });

      expect(await authorize(headers)).toBeNull();
    });

    it('refuses when the identity has no seller account', async () => {
      signedInAsSeller();
      readSellerAccountForIdentity.mockResolvedValue(null);

      expect(await authorize(headers)).toBeNull();
    });
  });
});

describe('resolveApiActor', () => {
  beforeEach(() => {
    vi.resetModules();
    findProductById.mockReset();
  });

  /**
   * The escalation this function exists to prevent.
   *
   * A logged-in seller naming another tenant's product id must be written as
   * THEMSELVES, so the domain function's own `stewardSellerAccountId` check
   * refuses it. If this returned the product's own steward instead, that
   * check would pass and the write would land in someone else's catalogue.
   */
  it('writes a session caller as their own tenant, never the product owner', async () => {
    findProductById.mockResolvedValue({
      id: PRODUCT_ID,
      stewardSellerAccountId: OTHER_SELLER_ACCOUNT_ID,
      version: 7,
    });

    const { resolveApiActor } = await import('./editor-api-auth');
    const actor = await resolveApiActor(
      {
        via: 'session',
        sellerAccountId: SELLER_ACCOUNT_ID,
        actorId: IDENTITY_ID,
      },
      PRODUCT_ID,
    );

    expect(actor).toEqual({
      sellerAccountId: SELLER_ACCOUNT_ID,
      actorId: IDENTITY_ID,
      productVersion: 7,
    });
    expect(actor?.sellerAccountId).not.toBe(OTHER_SELLER_ACCOUNT_ID);
  });

  it('still reports the row version, which is a token and not an authority', async () => {
    findProductById.mockResolvedValue({
      id: PRODUCT_ID,
      stewardSellerAccountId: SELLER_ACCOUNT_ID,
      version: 42,
    });

    const { resolveApiActor } = await import('./editor-api-auth');

    await expect(
      resolveApiActor(
        {
          via: 'session',
          sellerAccountId: SELLER_ACCOUNT_ID,
          actorId: IDENTITY_ID,
        },
        PRODUCT_ID,
      ),
    ).resolves.toMatchObject({ productVersion: 42 });
  });

  it('reports not-found for a product that does not exist', async () => {
    findProductById.mockResolvedValue(null);

    const { resolveApiActor } = await import('./editor-api-auth');

    await expect(
      resolveApiActor(
        {
          via: 'session',
          sellerAccountId: SELLER_ACCOUNT_ID,
          actorId: IDENTITY_ID,
        },
        PRODUCT_ID,
      ),
    ).resolves.toBeNull();
  });
});

describe('resolveApiCandidateActor', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('writes a session caller as their own tenant', async () => {
    const { resolveApiCandidateActor } = await import('./editor-api-auth');

    await expect(
      resolveApiCandidateActor(
        {
          via: 'session',
          sellerAccountId: SELLER_ACCOUNT_ID,
          actorId: IDENTITY_ID,
        },
        '44444444-4444-4444-4444-444444444444',
      ),
    ).resolves.toEqual({
      sellerAccountId: SELLER_ACCOUNT_ID,
      actorId: IDENTITY_ID,
    });
  });
});
