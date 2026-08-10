import { beforeEach, describe, expect, it, vi } from 'vitest';

const { transactionSpy } = vi.hoisted(() => ({
  transactionSpy: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  default: () => ({
    transaction: (run: (tx: unknown) => Promise<unknown>) => {
      transactionSpy();
      return run({ tx: true });
    },
  }),
  isDatabaseConfigured: () => true,
}));

vi.mock('@/lib/country-policy/buyer-destination-country', () => ({
  default: () => ({
    countryCodes: ['AU'],
    policyVersion: 'buyer-destination-v2',
    source: 'test',
    effective: 'ENABLED',
  }),
}));

vi.mock('../candidates/repository', () => ({
  appendAuditEvent: vi.fn(),
  findCandidateByConnectionAndExternalId: vi.fn(),
  insertCandidateIfAbsent: vi.fn(),
  insertQueuedEvaluationIfAbsent: vi.fn(),
  requeueIfFingerprintChanged: vi.fn(),
}));

vi.mock('./outbox-repository', () => ({
  insertOutboxIntents: vi.fn(),
}));

// eslint-disable-next-line import/first
import type { CjProduct } from '@/lib/cj/normalize';
// eslint-disable-next-line import/first
import type { SupplierConnectionRow } from '@/lib/db/schema';
// eslint-disable-next-line import/first
import {
  appendAuditEvent,
  findCandidateByConnectionAndExternalId,
  insertCandidateIfAbsent,
  insertQueuedEvaluationIfAbsent,
  requeueIfFingerprintChanged,
} from '../candidates/repository';
// eslint-disable-next-line import/first
import { insertOutboxIntents } from './outbox-repository';
// eslint-disable-next-line import/first
import ingestDiscoveredProduct from './ingest-product';

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const PRODUCT: CjProduct = {
  id: 'pid-1',
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

const CONNECTION = {
  id: 'connection-1',
  sellerAccountId: 'seller-1',
  status: 'CONNECTED',
} as SupplierConnectionRow;

const CONTEXT = { cycleId: 'cycle-1', partitionId: 'partition-1' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ingestDiscoveredProduct', () => {
  it('persists candidate, non-null status, admission audit, and the evaluation intent in ONE durable transaction', async () => {
    asMock(insertCandidateIfAbsent).mockResolvedValue({ id: 'candidate-1' });

    await expect(
      ingestDiscoveredProduct(PRODUCT, CONNECTION, CONTEXT),
    ).resolves.toBe('created');

    // One transaction wraps all four writes - a crash can never leave a
    // discovered product without a status or without its evaluation job.
    expect(transactionSpy).toHaveBeenCalledTimes(1);
    expect(insertQueuedEvaluationIfAbsent).toHaveBeenCalledWith(
      { tx: true },
      expect.objectContaining({ candidateId: 'candidate-1' }),
    );
    expect(appendAuditEvent).toHaveBeenCalledWith(
      { tx: true },
      expect.objectContaining({
        action: 'CANDIDATE_DISCOVERED',
        payload: expect.objectContaining({
          admissionReason: 'NEW_PRODUCT',
          cycleId: 'cycle-1',
          partitionId: 'partition-1',
        }),
      }),
    );
    expect(insertOutboxIntents).toHaveBeenCalledWith(
      { tx: true },
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.objectContaining({
            operation: 'EVALUATE_CANDIDATE',
            candidateId: 'candidate-1',
            admissionReason: 'NEW_PRODUCT',
          }),
        }),
      ]),
    );
  });

  it('requeues an existing candidate whose material fingerprint changed', async () => {
    asMock(insertCandidateIfAbsent).mockResolvedValue(null);
    asMock(findCandidateByConnectionAndExternalId).mockResolvedValue({
      id: 'candidate-1',
    });
    asMock(requeueIfFingerprintChanged).mockResolvedValue(true);

    await expect(
      ingestDiscoveredProduct(PRODUCT, CONNECTION, CONTEXT),
    ).resolves.toBe('requeued');

    expect(insertOutboxIntents).toHaveBeenCalledWith(
      { tx: true },
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.objectContaining({
            admissionReason: 'MATERIAL_SOURCE_CHANGE',
          }),
        }),
      ]),
    );
  });

  it('changes nothing for an unchanged product - idempotent under re-delivery and re-walked pages', async () => {
    asMock(insertCandidateIfAbsent).mockResolvedValue(null);
    asMock(findCandidateByConnectionAndExternalId).mockResolvedValue({
      id: 'candidate-1',
    });
    asMock(requeueIfFingerprintChanged).mockResolvedValue(false);

    await expect(
      ingestDiscoveredProduct(PRODUCT, CONNECTION, CONTEXT),
    ).resolves.toBe('unchanged');

    expect(insertQueuedEvaluationIfAbsent).not.toHaveBeenCalled();
    expect(insertOutboxIntents).not.toHaveBeenCalled();
    expect(appendAuditEvent).not.toHaveBeenCalled();
  });
});
