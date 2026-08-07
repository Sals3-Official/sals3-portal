import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  default: () => ({
    transaction: (run: (tx: unknown) => Promise<unknown>) => run({ tx: true }),
  }),
  isDatabaseConfigured: () => true,
}));

vi.mock('@/services/cj/products', () => ({ fetchCjProducts: vi.fn() }));

vi.mock('./repository', () => ({
  insertCandidateIfAbsent: vi.fn(),
  findCandidateByExternalId: vi.fn(),
  insertQueuedEvaluationIfAbsent: vi.fn(),
  requeueIfFingerprintChanged: vi.fn(),
}));

// eslint-disable-next-line import/first
import { fetchCjProducts } from '@/services/cj/products';
// eslint-disable-next-line import/first
import type { CjProduct } from '@/lib/cj/normalize';
// eslint-disable-next-line import/first
import {
  findCandidateByExternalId,
  insertCandidateIfAbsent,
  insertQueuedEvaluationIfAbsent,
  requeueIfFingerprintChanged,
} from './repository';
// eslint-disable-next-line import/first
import ingestCjFeed from './ingestion';

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const PRODUCT: CjProduct = {
  id: 'CJLY1',
  name: 'Plain phone case',
  sku: 'SKU-1',
  imageUrl: null,
  category: 'Phone accessories',
  priceCentsUsd: 500,
  weight: '100 g',
  productType: 'accessory',
  supplier: 'CJ',
  freeShipping: false,
  shipsFrom: ['CN'],
  listedCount: 10,
  createdAt: null,
};

function singlePageOf(products: CjProduct[]) {
  return {
    products,
    page: 1,
    pageSize: 20,
    total: products.length,
    totalPages: 1,
  };
}

describe('ingestCjFeed', () => {
  beforeEach(() => {
    asMock(fetchCjProducts).mockReset();
    asMock(insertCandidateIfAbsent).mockReset();
    asMock(findCandidateByExternalId).mockReset();
    asMock(insertQueuedEvaluationIfAbsent)
      .mockReset()
      .mockResolvedValue(undefined);
    asMock(requeueIfFingerprintChanged).mockReset().mockResolvedValue(false);
  });

  it('creates a candidate and a QUEUED evaluation for an unseen product', async () => {
    asMock(fetchCjProducts).mockResolvedValue(singlePageOf([PRODUCT]));
    asMock(insertCandidateIfAbsent).mockResolvedValue({
      id: 'candidate-1',
      shortlistState: 'SHORTLISTED',
    });

    const result = await ingestCjFeed();

    expect(insertQueuedEvaluationIfAbsent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ candidateId: 'candidate-1' }),
    );
    expect(result).toMatchObject({
      candidatesSeen: 1,
      candidatesCreated: 1,
      candidatesRequeued: 0,
    });
  });

  it('does not duplicate an already-ingested product, and only counts a requeue when the fingerprint actually changed', async () => {
    asMock(fetchCjProducts).mockResolvedValue(singlePageOf([PRODUCT]));
    asMock(insertCandidateIfAbsent).mockResolvedValue(null); // conflict: already exists
    asMock(findCandidateByExternalId).mockResolvedValue({ id: 'candidate-1' });
    asMock(requeueIfFingerprintChanged).mockResolvedValue(false); // unchanged since last ingestion

    const result = await ingestCjFeed();

    expect(insertQueuedEvaluationIfAbsent).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      candidatesSeen: 1,
      candidatesCreated: 0,
      candidatesRequeued: 0,
    });
  });

  it('counts a requeue only when the repository reports the row actually changed', async () => {
    asMock(fetchCjProducts).mockResolvedValue(singlePageOf([PRODUCT]));
    asMock(insertCandidateIfAbsent).mockResolvedValue(null);
    asMock(findCandidateByExternalId).mockResolvedValue({ id: 'candidate-1' });
    asMock(requeueIfFingerprintChanged).mockResolvedValue(true);

    const result = await ingestCjFeed();

    expect(result.candidatesRequeued).toBe(1);
  });

  it('stops paging once the feed reports it has reached the last page', async () => {
    asMock(fetchCjProducts).mockResolvedValue(singlePageOf([]));

    await ingestCjFeed();

    expect(fetchCjProducts).toHaveBeenCalledTimes(1);
  });
});
