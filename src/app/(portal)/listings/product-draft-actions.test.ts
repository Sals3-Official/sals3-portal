import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/session', () => ({
  requirePermission: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  default: () => ({ marker: 'db' }),
  isDatabaseConfigured: vi.fn(() => true),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true, retryAfterMs: 0 })),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/modules/catalog/products/create-draft', () => ({
  default: vi.fn(),
}));

vi.mock('@/modules/catalog/products/save-draft', () => ({
  default: vi.fn(),
}));

/* eslint-disable import/first */
import { PermissionError } from '@/lib/auth/permissions';
import { requirePermission } from '@/lib/auth/session';
import { isDatabaseConfigured } from '@/lib/db/client';
import { checkRateLimit } from '@/lib/rate-limit';
import createProductDraftFromCandidate from '@/modules/catalog/products/create-draft';
import saveProductDraft from '@/modules/catalog/products/save-draft';
import { revalidatePath } from 'next/cache';

import {
  bulkCreateProductDraftsAction,
  createProductDraftAction,
  saveProductDraftAction,
} from './product-draft-actions';
/* eslint-enable import/first */

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const CANDIDATE = '33333333-3333-4333-8333-333333333333';
const SELLER = '11111111-1111-4111-8111-111111111111';

const VALID_CREATE = {
  candidateId: CANDIDATE,
  idempotencyKey: 'idem-key-0001',
};

const SESSION = {
  userId: 'actor-1',
  displayName: 'Tester',
  role: 'seller_manager' as const,
  sellerId: SELLER,
  sellerBusinessModel: 'DROPSHIPPER' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  asMock(isDatabaseConfigured).mockReturnValue(true);
  asMock(checkRateLimit).mockReturnValue({ allowed: true, retryAfterMs: 0 });
  asMock(requirePermission).mockResolvedValue(SESSION);
  asMock(createProductDraftFromCandidate).mockResolvedValue({
    ok: true,
    result: {
      productId: 'product-1',
      revisionId: 'revision-1',
      variantIds: [],
      offerIds: [],
      publicationState: 'UNPUBLISHED',
      missingRequirements: [],
      pricingUnavailableReason: null,
      replayed: false,
    },
  });
  asMock(saveProductDraft).mockResolvedValue({
    ok: true,
    revisionVersion: 4,
    contentChecksum: 'checksum',
  });
});

describe('createProductDraftAction — authorization', () => {
  it('requires the import permission before touching the domain module', async () => {
    await createProductDraftAction(VALID_CREATE);

    expect(requirePermission).toHaveBeenCalledWith('product:import');
  });

  it('denies a role without the permission and calls nothing', async () => {
    asMock(requirePermission).mockRejectedValue(new PermissionError());

    await expect(createProductDraftAction(VALID_CREATE)).resolves.toEqual({
      ok: false,
      reason: 'denied',
    });
    expect(createProductDraftFromCandidate).not.toHaveBeenCalled();
  });

  it('denies a Retailer account even when it holds the permission', async () => {
    // ADR-006: sourcing from a supplier is a Dropshipper capability, and the
    // permission alone does not grant it.
    asMock(requirePermission).mockResolvedValue({
      ...SESSION,
      sellerBusinessModel: 'RETAILER',
    });

    await expect(createProductDraftAction(VALID_CREATE)).resolves.toEqual({
      ok: false,
      reason: 'denied',
    });
    expect(createProductDraftFromCandidate).not.toHaveBeenCalled();
  });

  it('rate-limits per seller account', async () => {
    asMock(checkRateLimit).mockReturnValue({
      allowed: false,
      retryAfterMs: 1_000,
    });

    await expect(createProductDraftAction(VALID_CREATE)).resolves.toEqual({
      ok: false,
      reason: 'rate_limited',
    });
    expect(asMock(checkRateLimit).mock.calls[0][0]).toContain(SELLER);
  });

  it('degrades honestly when no database is configured', async () => {
    // CI and preview deploys have no DATABASE_URL. This must be an explicit
    // state, not a 500 from a query that was never going to work.
    asMock(isDatabaseConfigured).mockReturnValue(false);

    await expect(createProductDraftAction(VALID_CREATE)).resolves.toEqual({
      ok: false,
      reason: 'not_configured',
    });
    expect(requirePermission).not.toHaveBeenCalled();
  });
});

describe('createProductDraftAction — input handling', () => {
  it('resolves the tenant and actor from the session, never from the payload', async () => {
    await createProductDraftAction({
      ...VALID_CREATE,
      // A crafted payload has nothing to escalate with: these keys are not in
      // the schema and are stripped before the domain module sees anything.
      sellerAccountId: 'attacker-seller',
      actorId: 'attacker-actor',
      productId: 'someone-elses-product',
    });

    expect(createProductDraftFromCandidate).toHaveBeenCalledWith({
      candidateId: CANDIDATE,
      sellerAccountId: SELLER,
      actorId: 'actor-1',
      idempotencyKey: 'idem-key-0001',
    });
  });

  it('rejects a malformed candidate id and a malformed idempotency key', async () => {
    await expect(
      createProductDraftAction({ ...VALID_CREATE, candidateId: 'not-a-uuid' }),
    ).resolves.toEqual({ ok: false, reason: 'invalid_input' });

    await expect(
      createProductDraftAction({ ...VALID_CREATE, idempotencyKey: 'a b/c' }),
    ).resolves.toEqual({ ok: false, reason: 'invalid_input' });

    expect(createProductDraftFromCandidate).not.toHaveBeenCalled();
  });

  it('rejects a non-object payload without authorizing', async () => {
    await expect(createProductDraftAction(null)).resolves.toEqual({
      ok: false,
      reason: 'invalid_input',
    });
    expect(requirePermission).not.toHaveBeenCalled();
  });

  it('passes through not_found and idempotency_conflict unchanged', async () => {
    asMock(createProductDraftFromCandidate).mockResolvedValue({
      ok: false,
      reason: 'not_found',
    });
    await expect(createProductDraftAction(VALID_CREATE)).resolves.toEqual({
      ok: false,
      reason: 'not_found',
    });

    asMock(createProductDraftFromCandidate).mockResolvedValue({
      ok: false,
      reason: 'idempotency_conflict',
    });
    await expect(createProductDraftAction(VALID_CREATE)).resolves.toEqual({
      ok: false,
      reason: 'idempotency_conflict',
    });
  });

  it('returns a generic failure and leaks no internal detail on an unexpected error', async () => {
    asMock(createProductDraftFromCandidate).mockRejectedValue(
      new Error('relation "products" violates constraint pg_xyz'),
    );
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const outcome = await createProductDraftAction(VALID_CREATE);

    expect(outcome).toEqual({ ok: false, reason: 'failed' });
    expect(JSON.stringify(outcome)).not.toContain('pg_xyz');
    consoleError.mockRestore();
  });
});

describe('bulkCreateProductDraftsAction', () => {
  it('imports selected candidates with one server-resolved tenant and actor', async () => {
    const secondCandidate = '44444444-4444-4444-8444-444444444444';

    await expect(
      bulkCreateProductDraftsAction({
        requests: [
          { candidateId: CANDIDATE, idempotencyKey: 'idem-key-0001' },
          { candidateId: secondCandidate, idempotencyKey: 'idem-key-0002' },
        ],
      }),
    ).resolves.toEqual({
      ok: true,
      created: 2,
      replayed: 0,
      failed: [],
    });

    expect(createProductDraftFromCandidate).toHaveBeenCalledWith({
      candidateId: CANDIDATE,
      sellerAccountId: SELLER,
      actorId: 'actor-1',
      idempotencyKey: 'idem-key-0001',
    });
    expect(createProductDraftFromCandidate).toHaveBeenCalledWith({
      candidateId: secondCandidate,
      sellerAccountId: SELLER,
      actorId: 'actor-1',
      idempotencyKey: 'idem-key-0002',
    });
  });

  it('revalidates sourcing and catalogue pages after a successful batch', async () => {
    await bulkCreateProductDraftsAction({
      requests: [{ candidateId: CANDIDATE, idempotencyKey: 'idem-key-0001' }],
    });

    expect(revalidatePath).toHaveBeenCalledWith('/products/pipeline');
    expect(revalidatePath).toHaveBeenCalledWith('/listings');
  });

  it('rejects an unbounded batch before authorizing', async () => {
    const requests = Array.from({ length: 51 }, (_, index) => ({
      candidateId: CANDIDATE,
      idempotencyKey: `idem-key-${index.toString().padStart(4, '0')}`,
    }));

    await expect(bulkCreateProductDraftsAction({ requests })).resolves.toEqual({
      ok: false,
      reason: 'invalid_input',
    });
    expect(requirePermission).not.toHaveBeenCalled();
  });
});

describe('saveProductDraftAction', () => {
  const VALID_SAVE = {
    productId: '44444444-4444-4444-8444-444444444444',
    revisionId: '55555555-5555-4555-8555-555555555555',
    expectedRevisionVersion: 3,
    title: 'Merino crew neck',
    sals3CategoryL1: 'Beauty & Personal Care',
    descriptionDocument: {
      version: 1,
      blocks: [{ type: 'paragraph', text: 'Soft merino wool.' }],
    },
  };

  it('requires the edit permission', async () => {
    await saveProductDraftAction(VALID_SAVE);

    expect(requirePermission).toHaveBeenCalledWith('product:edit');
  });

  it('passes the validated draft L1 category to the domain module', async () => {
    await saveProductDraftAction(VALID_SAVE);

    expect(saveProductDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          sals3CategoryL1: 'Beauty & Personal Care',
        }),
        sellerAccountId: SELLER,
        actorId: 'actor-1',
      }),
    );
  });

  it('rejects a category outside the Sals3 taxonomy L1 list', async () => {
    await expect(
      saveProductDraftAction({
        ...VALID_SAVE,
        sals3CategoryL1: 'Men Jackets',
      }),
    ).resolves.toEqual({ ok: false, reason: 'invalid_input' });
    expect(saveProductDraft).not.toHaveBeenCalled();
  });

  it('rejects a description document containing markup', async () => {
    // The allow list runs at this boundary, so unsafe content is never stored
    // and never depends on a renderer escaping it later.
    await expect(
      saveProductDraftAction({
        ...VALID_SAVE,
        descriptionDocument: {
          version: 1,
          blocks: [{ type: 'paragraph', text: '<script>alert(1)</script>' }],
        },
      }),
    ).resolves.toEqual({ ok: false, reason: 'invalid_input' });
    expect(saveProductDraft).not.toHaveBeenCalled();
  });

  it('rejects an unknown block type', async () => {
    await expect(
      saveProductDraftAction({
        ...VALID_SAVE,
        descriptionDocument: {
          version: 1,
          blocks: [{ type: 'rawHtml', value: '<p>x</p>' }],
        },
      }),
    ).resolves.toEqual({ ok: false, reason: 'invalid_input' });
  });

  it('rejects a missing or non-positive expected version', async () => {
    // Without an expected version there is no compare-and-set, so a stale tab
    // could overwrite a change it never rendered.
    await expect(
      saveProductDraftAction({ ...VALID_SAVE, expectedRevisionVersion: 0 }),
    ).resolves.toEqual({ ok: false, reason: 'invalid_input' });
  });

  it('reports a version conflict from the domain module', async () => {
    asMock(saveProductDraft).mockResolvedValue({
      ok: false,
      reason: 'version_conflict',
    });

    await expect(saveProductDraftAction(VALID_SAVE)).resolves.toEqual({
      ok: false,
      reason: 'version_conflict',
    });
  });

  it('reports not_found for another tenant`s product', async () => {
    asMock(saveProductDraft).mockResolvedValue({
      ok: false,
      reason: 'not_found',
    });

    await expect(saveProductDraftAction(VALID_SAVE)).resolves.toEqual({
      ok: false,
      reason: 'not_found',
    });
  });
});
