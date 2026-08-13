import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

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

vi.mock('@/modules/catalog/products/create-draft', () => ({
  default: vi.fn(),
}));

vi.mock('@/modules/catalog/products/repository', () => ({
  listCandidateIdsWithProducts: vi.fn(async () => []),
}));

/* eslint-disable import/first */
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/session';
import { isDatabaseConfigured } from '@/lib/db/client';
import { checkRateLimit } from '@/lib/rate-limit';
import createProductDraftFromCandidate from '@/modules/catalog/products/create-draft';
import { listCandidateIdsWithProducts } from '@/modules/catalog/products/repository';
import bulkCreateProductDraftsAction from './bulk-draft-action';
/* eslint-enable import/first */

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const SELLER = '11111111-1111-4111-8111-111111111111';
const CANDIDATE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CANDIDATE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CANDIDATE_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const SESSION = {
  userId: 'actor-1',
  displayName: 'Tester',
  role: 'seller_manager' as const,
  sellerId: SELLER,
  sellerBusinessModel: 'DROPSHIPPER' as const,
};

function createdOutcome(productId: string) {
  return {
    ok: true as const,
    result: { productId, missingRequirements: ['CATEGORY_MAPPING_REQUIRED'] },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  asMock(isDatabaseConfigured).mockReturnValue(true);
  asMock(checkRateLimit).mockReturnValue({ allowed: true, retryAfterMs: 0 });
  asMock(requirePermission).mockResolvedValue(SESSION);
  asMock(listCandidateIdsWithProducts).mockResolvedValue([]);
  asMock(createProductDraftFromCandidate).mockResolvedValue(
    createdOutcome('product-1'),
  );
});

describe('bulkCreateProductDraftsAction input boundary', () => {
  it('rejects a non-uuid id, an empty list, and a list past the cap', async () => {
    const base = { idempotencyKeyBase: 'bulk-key-0001' };

    await expect(
      bulkCreateProductDraftsAction({ ...base, candidateIds: ['nope'] }),
    ).resolves.toEqual({ ok: false, reason: 'invalid_input' });
    await expect(
      bulkCreateProductDraftsAction({ ...base, candidateIds: [] }),
    ).resolves.toEqual({ ok: false, reason: 'invalid_input' });
    await expect(
      bulkCreateProductDraftsAction({
        ...base,
        candidateIds: Array.from({ length: 101 }, () => CANDIDATE_A),
      }),
    ).resolves.toEqual({ ok: false, reason: 'invalid_input' });
    expect(createProductDraftFromCandidate).not.toHaveBeenCalled();
  });

  it('dedups repeated ids inside the cap to one create each', async () => {
    const result = await bulkCreateProductDraftsAction({
      candidateIds: [CANDIDATE_A, CANDIDATE_A, CANDIDATE_A],
      idempotencyKeyBase: 'bulk-key-0001',
    });

    expect(result.ok).toBe(true);
    expect(createProductDraftFromCandidate).toHaveBeenCalledTimes(1);
  });

  it('rejects a key base too long to carry the per-candidate suffix', async () => {
    await expect(
      bulkCreateProductDraftsAction({
        candidateIds: [CANDIDATE_A],
        idempotencyKeyBase: 'k'.repeat(170),
      }),
    ).resolves.toEqual({ ok: false, reason: 'invalid_input' });
  });
});

describe('bulkCreateProductDraftsAction authorization', () => {
  it('denies before any create runs', async () => {
    asMock(requirePermission).mockRejectedValue(
      new (await import('@/lib/auth/permissions')).PermissionError(),
    );

    await expect(
      bulkCreateProductDraftsAction({
        candidateIds: [CANDIDATE_A],
        idempotencyKeyBase: 'bulk-key-0001',
      }),
    ).resolves.toEqual({ ok: false, reason: 'denied' });
    expect(createProductDraftFromCandidate).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('uses its own rate bucket, not the single-draft one', async () => {
    await bulkCreateProductDraftsAction({
      candidateIds: [CANDIDATE_A],
      idempotencyKeyBase: 'bulk-key-0001',
    });

    expect(checkRateLimit).toHaveBeenCalledWith(
      `catalog-draft:bulk:${SELLER}`,
      { capacity: 10, refillIntervalMs: 60_000 },
    );
  });
});

describe('bulkCreateProductDraftsAction outcomes', () => {
  it('reports pre-existing products without creating them again', async () => {
    asMock(listCandidateIdsWithProducts).mockResolvedValue([
      { sourceCandidateId: CANDIDATE_B, productId: 'product-b' },
    ]);

    const result = await bulkCreateProductDraftsAction({
      candidateIds: [CANDIDATE_A, CANDIDATE_B],
      idempotencyKeyBase: 'bulk-key-0001',
    });

    expect(result).toEqual({
      ok: true,
      outcomes: [
        {
          candidateId: CANDIDATE_A,
          status: 'created',
          productId: 'product-1',
          missingRequirements: ['CATEGORY_MAPPING_REQUIRED'],
        },
        { candidateId: CANDIDATE_B, status: 'already_in_catalogue' },
      ],
    });
    expect(createProductDraftFromCandidate).toHaveBeenCalledTimes(1);
  });

  /** One row throwing must not take the rest of the page down with it. */
  it('continues past a throwing candidate and reports it failed', async () => {
    asMock(createProductDraftFromCandidate)
      .mockResolvedValueOnce(createdOutcome('product-a'))
      .mockRejectedValueOnce(new Error('constraint blew up'))
      .mockResolvedValueOnce(createdOutcome('product-c'));

    const result = await bulkCreateProductDraftsAction({
      candidateIds: [CANDIDATE_A, CANDIDATE_B, CANDIDATE_C],
      idempotencyKeyBase: 'bulk-key-0001',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.outcomes.map((outcome) => outcome.status)).toEqual([
      'created',
      'failed',
      'created',
    ]);
    expect(createProductDraftFromCandidate).toHaveBeenCalledTimes(3);
  });

  it('derives one idempotency key per candidate from the base', async () => {
    await bulkCreateProductDraftsAction({
      candidateIds: [CANDIDATE_A, CANDIDATE_B],
      idempotencyKeyBase: 'bulk-key-0001',
    });

    expect(createProductDraftFromCandidate).toHaveBeenNthCalledWith(1, {
      candidateId: CANDIDATE_A,
      sellerAccountId: SELLER,
      actorId: 'actor-1',
      idempotencyKey: `bulk-key-0001:${CANDIDATE_A}`,
    });
    expect(createProductDraftFromCandidate).toHaveBeenNthCalledWith(2, {
      candidateId: CANDIDATE_B,
      sellerAccountId: SELLER,
      actorId: 'actor-1',
      idempotencyKey: `bulk-key-0001:${CANDIDATE_B}`,
    });
  });

  it('revalidates the pipeline and the catalogue after the loop', async () => {
    await bulkCreateProductDraftsAction({
      candidateIds: [CANDIDATE_A],
      idempotencyKeyBase: 'bulk-key-0001',
    });

    expect(revalidatePath).toHaveBeenCalledWith('/products/pipeline');
    expect(revalidatePath).toHaveBeenCalledWith('/listings');
  });

  it('reports a domain refusal as a failed row, not a thrown batch', async () => {
    asMock(createProductDraftFromCandidate).mockResolvedValue({
      ok: false,
      reason: 'not_found',
    });

    const result = await bulkCreateProductDraftsAction({
      candidateIds: [CANDIDATE_A],
      idempotencyKeyBase: 'bulk-key-0001',
    });

    expect(result).toEqual({
      ok: true,
      outcomes: [
        { candidateId: CANDIDATE_A, status: 'failed', reason: 'not_found' },
      ],
    });
  });
});
