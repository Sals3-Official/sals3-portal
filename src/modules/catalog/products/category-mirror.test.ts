// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/modules/catalog/candidates/repository', () => ({
  appendAuditEvent: vi.fn(),
  findEvaluationByCandidateId: vi.fn(),
  findSnapshotByCandidateId: vi.fn(),
}));

vi.mock('@/modules/catalog/taxonomy/cj-mirror', () => ({
  ensureCjCategoryMirror: vi.fn(),
}));

vi.mock('@/modules/catalog/taxonomy/repository', () => ({
  assignProductCategory: vi.fn(),
}));

vi.mock('./repository', () => ({
  findCandidateSourceForSeller: vi.fn(),
}));

/* eslint-disable import/first */
import {
  appendAuditEvent,
  findEvaluationByCandidateId,
  findSnapshotByCandidateId,
} from '@/modules/catalog/candidates/repository';
import { ensureCjCategoryMirror } from '@/modules/catalog/taxonomy/cj-mirror';
import { assignProductCategory } from '@/modules/catalog/taxonomy/repository';

import { ensureProductCjCategory } from './category-mirror';
import { findCandidateSourceForSeller } from './repository';
/* eslint-enable import/first */

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const EXECUTOR = { marker: 'tx' } as never;

const SOURCE = {
  candidateId: 'candidate-1',
  externalProductId: 'PID-1',
  supplierConnectionId: 'connection-1',
  connectionStatus: 'CONNECTED',
  supplierProviderId: 'provider-1',
  supplierProviderCode: 'CJ_DROPSHIPPING',
  providerCategoryId: '2409230540351618000',
};

const MIRRORED = {
  mapping: {
    id: 'mirror-1',
    mappingVersion: 1,
    confidence: 'EXACT',
    taxonomyVersion: 'sals3-taxonomy-v0',
  },
  category: {
    id: 'category-1',
    code: 'CJ-2409230540351618000',
    path: "Men's Jackets",
  },
};

function ensure() {
  return ensureProductCjCategory(EXECUTOR, {
    productId: 'product-1',
    stewardSellerAccountId: 'seller-1',
    expectedProductVersion: 1,
    candidateId: 'candidate-1',
    actorId: 'actor-1',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  asMock(findCandidateSourceForSeller).mockResolvedValue(SOURCE);
  asMock(findSnapshotByCandidateId).mockResolvedValue(null);
  asMock(findEvaluationByCandidateId).mockResolvedValue({
    feedSnapshot: {
      name: 'Feed name',
      category: "Men's Jackets",
      categoryId: '2409230540351618000',
      priceUsdCents: 1526,
      listedCount: 17,
      shipsFrom: ['CN'],
    },
  });
  asMock(ensureCjCategoryMirror).mockResolvedValue(MIRRORED);
  asMock(assignProductCategory).mockResolvedValue({
    id: 'product-1',
    version: 2,
  });
  asMock(appendAuditEvent).mockResolvedValue(undefined);
});

describe('ensureProductCjCategory', () => {
  it('categorises the product from its CJ category and reports the bumped version', async () => {
    const result = await ensure();

    expect(result).toEqual({
      categoryCode: 'CJ-2409230540351618000',
      categoryMappingConfidence: 'EXACT',
      productVersion: 2,
    });
    expect(assignProductCategory).toHaveBeenCalledWith(
      EXECUTOR,
      expect.objectContaining({
        productId: 'product-1',
        stewardSellerAccountId: 'seller-1',
        expectedVersion: 1,
        categoryId: 'category-1',
        categoryMappingConfidence: 'EXACT',
        categoryMappingId: 'mirror-1',
      }),
    );
    expect(appendAuditEvent).toHaveBeenCalledWith(
      EXECUTOR,
      expect.objectContaining({
        payload: expect.objectContaining({ assignedAtPublish: true }),
      }),
    );
  });

  it('prefers the detail-evidence category name over the feed summary', async () => {
    asMock(findSnapshotByCandidateId).mockResolvedValue({
      evidence: { categoryName: 'Evidence name' },
    });

    await ensure();

    expect(ensureCjCategoryMirror).toHaveBeenCalledWith(
      EXECUTOR,
      expect.objectContaining({ observedCategoryPath: 'Evidence name' }),
    );
  });

  it('answers null when the candidate carries no provider category id', async () => {
    asMock(findCandidateSourceForSeller).mockResolvedValue({
      ...SOURCE,
      providerCategoryId: null,
    });

    expect(await ensure()).toBeNull();
    expect(ensureCjCategoryMirror).not.toHaveBeenCalled();
    expect(assignProductCategory).not.toHaveBeenCalled();
  });

  it('answers null for a cross-tenant or unknown candidate, writing nothing', async () => {
    asMock(findCandidateSourceForSeller).mockResolvedValue(null);

    expect(await ensure()).toBeNull();
    expect(ensureCjCategoryMirror).not.toHaveBeenCalled();
    expect(assignProductCategory).not.toHaveBeenCalled();
  });

  it('answers null when the compare-and-set loses to a concurrent edit', async () => {
    asMock(assignProductCategory).mockResolvedValue(null);

    expect(await ensure()).toBeNull();
    expect(appendAuditEvent).not.toHaveBeenCalled();
  });
});
