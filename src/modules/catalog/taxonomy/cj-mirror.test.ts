// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./repository', () => ({
  findActiveMapping: vi.fn(),
  findCategoryByCode: vi.fn(),
  findHighestMappingVersion: vi.fn(),
  insertMappingProposal: vi.fn(),
  reviewMapping: vi.fn(),
  supersedeActiveMapping: vi.fn(),
}));

/* eslint-disable import/first */
import { ensureCjCategoryMirror } from './cj-mirror';
import {
  findActiveMapping,
  findCategoryByCode,
  findHighestMappingVersion,
  insertMappingProposal,
  reviewMapping,
  supersedeActiveMapping,
} from './repository';
/* eslint-enable import/first */

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const EXTERNAL_ID = '2409230540351618000';

const MIRROR_CATEGORY = {
  id: 'category-1',
  code: `CJ-${EXTERNAL_ID}`,
  path: "Men's Jackets",
};

const PROPOSED = {
  id: 'mapping-1',
  mappingVersion: 1,
  confidence: 'EXACT',
  status: 'PROPOSED',
};

const ACTIVATED = {
  ...PROPOSED,
  status: 'ACTIVE',
  reviewStatus: 'APPROVED',
};

/** Records category-row inserts and answers like postgres.js would. */
function executorWithCategoryInsert(returned: unknown[] = [MIRROR_CATEGORY]) {
  const values = vi.fn(() => ({
    onConflictDoNothing: vi.fn(() => ({
      returning: vi.fn(() => Promise.resolve(returned)),
    })),
  }));

  return { executor: { insert: vi.fn(() => ({ values })) }, values };
}

function mirror(executor: unknown, externalCategoryId: string | null) {
  return ensureCjCategoryMirror(executor as never, {
    provider: 'CJ_DROPSHIPPING',
    externalCategoryId,
    observedCategoryPath: "Men's Jackets",
    actorId: 'actor-1',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  asMock(findActiveMapping).mockResolvedValue(null);
  asMock(findCategoryByCode).mockResolvedValue(null);
  asMock(findHighestMappingVersion).mockResolvedValue(0);
  asMock(insertMappingProposal).mockResolvedValue(PROPOSED);
  asMock(reviewMapping).mockResolvedValue(ACTIVATED);
  asMock(supersedeActiveMapping).mockResolvedValue(null);
});

describe('ensureCjCategoryMirror', () => {
  it('creates the mirror category and an ACTIVE, APPROVED external-id rule', async () => {
    const { executor } = executorWithCategoryInsert();

    const result = await mirror(executor, EXTERNAL_ID);

    expect(result).toEqual({ mapping: ACTIVATED, category: MIRROR_CATEGORY });
    expect(insertMappingProposal).toHaveBeenCalledWith(
      executor,
      expect.objectContaining({
        provider: 'CJ_DROPSHIPPING',
        externalCategoryId: EXTERNAL_ID,
        sals3CategoryId: 'category-1',
        mappingVersion: 1,
        method: 'EXTERNAL_ID_RULE',
        confidence: 'EXACT',
      }),
    );
    expect(reviewMapping).toHaveBeenCalledWith(
      executor,
      expect.objectContaining({
        mappingId: 'mapping-1',
        nextReviewStatus: 'APPROVED',
        nextStatus: 'ACTIVE',
      }),
    );
  });

  it('returns an existing decision-in-force untouched, reviewed or mirrored', async () => {
    const existing = {
      mapping: {
        id: 'reviewed-1',
        mappingVersion: 3,
        confidence: 'ACCEPTABLE',
      },
      category: { id: 'curated-1', code: 'CAT-MEN-100230', path: 'Curated' },
    };

    asMock(findActiveMapping).mockResolvedValue(existing);
    const { executor } = executorWithCategoryInsert();

    expect(await mirror(executor, EXTERNAL_ID)).toBe(existing);
    expect(insertMappingProposal).not.toHaveBeenCalled();
    expect(executor.insert).not.toHaveBeenCalled();
  });

  it('supersedes an active decision that names no category before mirroring', async () => {
    asMock(findActiveMapping).mockResolvedValue({
      mapping: { id: 'unmapped-1', mappingVersion: 2, confidence: 'UNMAPPED' },
      category: null,
    });
    asMock(supersedeActiveMapping).mockResolvedValue({ id: 'unmapped-1' });
    asMock(findHighestMappingVersion).mockResolvedValue(2);
    asMock(insertMappingProposal).mockResolvedValue({
      ...PROPOSED,
      mappingVersion: 3,
    });
    asMock(reviewMapping).mockResolvedValue({
      ...ACTIVATED,
      mappingVersion: 3,
    });
    const { executor } = executorWithCategoryInsert();

    const result = await mirror(executor, EXTERNAL_ID);

    expect(supersedeActiveMapping).toHaveBeenCalledWith(
      executor,
      expect.objectContaining({ expectedMappingVersion: 2 }),
    );
    expect(insertMappingProposal).toHaveBeenCalledWith(
      executor,
      expect.objectContaining({
        mappingVersion: 3,
        supersedesId: 'unmapped-1',
      }),
    );
    expect(result?.mapping.mappingVersion).toBe(3);
  });

  it('reuses an existing mirror category row instead of inserting a duplicate', async () => {
    asMock(findCategoryByCode).mockResolvedValue(MIRROR_CATEGORY);
    const { executor } = executorWithCategoryInsert();

    const result = await mirror(executor, EXTERNAL_ID);

    expect(executor.insert).not.toHaveBeenCalled();
    expect(result?.category).toBe(MIRROR_CATEGORY);
  });

  it('answers null for a blank or missing external category id, writing nothing', async () => {
    const { executor } = executorWithCategoryInsert();

    expect(await mirror(executor, null)).toBeNull();
    expect(await mirror(executor, '   ')).toBeNull();
    expect(findActiveMapping).not.toHaveBeenCalled();
    expect(executor.insert).not.toHaveBeenCalled();
  });

  it('answers null when a concurrent writer wins the version race', async () => {
    asMock(insertMappingProposal).mockResolvedValue(null);
    const { executor } = executorWithCategoryInsert();

    expect(await mirror(executor, EXTERNAL_ID)).toBeNull();
    expect(reviewMapping).not.toHaveBeenCalled();
  });
});
