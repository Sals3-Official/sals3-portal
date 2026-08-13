// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { candidateEvaluations, supplierSnapshots } from '@/lib/db/schema';
import { projectSupplierMediaForProduct } from './media-projection';

const PRODUCT_ID = '90a329b9-56aa-4f54-abb2-ad843602aa73';
const CANDIDATE_ID = 'cb9bc366-63d6-42d5-9bd2-38384de8e5d4';
const RIGHTS = {
  rightsBasis: 'SUPPLIER_TERMS',
  reviewState: 'APPROVED',
} as const;

const CAPTURED_AT = new Date('2026-08-13T10:00:00.000Z');
const EVALUATED_AT = new Date('2026-08-11T04:00:00.000Z');

/**
 * A minimal recorder that dispatches on the table each `select` reads, rather
 * than on call order. Order-based dispatch was wrong here: whether the module
 * reads the evaluation at all depends on how many snapshot URLs survive the
 * host allow-list, which the harness cannot know in advance.
 */
function executorWith(options: {
  snapshotImageUrls?: unknown;
  feedImageUrl?: string | null;
  existingUrls?: string[];
}) {
  const inserted: unknown[] = [];

  const snapshotRows =
    options.snapshotImageUrls === undefined
      ? []
      : [
          {
            evidence: { imageUrls: options.snapshotImageUrls },
            capturedAt: CAPTURED_AT,
          },
        ];
  const evaluationRows =
    options.feedImageUrl === undefined
      ? []
      : [
          {
            feedSnapshot: {
              name: 'Jacket',
              category: "Men's Jackets",
              priceUsdCents: 796,
              listedCount: 13,
              shipsFrom: ['CN'],
              imageUrl: options.feedImageUrl,
            },
            evaluatedAt: EVALUATED_AT,
            updatedAt: EVALUATED_AT,
          },
        ];
  const mediaRows = (options.existingUrls ?? []).map((sourceUrl) => ({
    sourceUrl,
  }));

  // Identity comparison against the real schema objects, so a renamed table
  // cannot make this harness silently answer the wrong read.
  const rowsForTable = (table: unknown): unknown[] => {
    if (table === supplierSnapshots) return snapshotRows;
    if (table === candidateEvaluations) return evaluationRows;

    return mediaRows;
  };

  const chain = () => {
    let rows: unknown[] = [];
    const builder: Record<string, unknown> = {};

    builder.from = vi.fn((table: unknown) => {
      rows = rowsForTable(table);

      return builder;
    });
    builder.where = vi.fn(() => builder);
    builder.limit = vi.fn(() => rows);
    builder.then = (resolve: (value: unknown) => unknown) => resolve(rows);

    return builder;
  };

  const executor = {
    select: vi.fn(chain),
    insert: vi.fn(() => ({
      values: vi.fn((rows: unknown) => {
        inserted.push(rows);

        return Promise.resolve(undefined);
      }),
    })),
  };

  return { executor, inserted };
}

describe('projectSupplierMediaForProduct', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('projects the full allow-listed set from detail evidence', async () => {
    const { executor, inserted } = executorWith({
      snapshotImageUrls: [
        'https://cf.cjdropshipping.com/quick/product/a.jpg',
        'https://oss-cf.cjdropshipping.com/quick/product/b.jpg',
      ],
    });

    const result = await projectSupplierMediaForProduct(executor as never, {
      productId: PRODUCT_ID,
      candidateId: CANDIDATE_ID,
      actorId: 'actor-1',
      rights: RIGHTS,
    });

    expect(result).toEqual({
      inserted: 2,
      skipped: 0,
      source: 'DETAIL_EVIDENCE',
    });
    expect(inserted[0]).toEqual([
      expect.objectContaining({
        productId: PRODUCT_ID,
        sourceType: 'SUPPLIER_ORIGINAL',
        rightsBasis: 'SUPPLIER_TERMS',
        reviewState: 'APPROVED',
        // The observation time, never `now()`: claiming this image was seen at
        // insert time would overstate its freshness.
        observedAt: CAPTURED_AT,
      }),
      expect.anything(),
    ]);
  });

  it('never records a checksum, content type, or dimensions it did not read', async () => {
    const { executor, inserted } = executorWith({
      snapshotImageUrls: ['https://cf.cjdropshipping.com/quick/product/a.jpg'],
    });

    await projectSupplierMediaForProduct(executor as never, {
      productId: PRODUCT_ID,
      candidateId: CANDIDATE_ID,
      actorId: 'actor-1',
      rights: RIGHTS,
    });

    const row = (inserted[0] as Record<string, unknown>[])[0];

    [
      'checksum',
      'contentType',
      'byteSize',
      'widthPixels',
      'heightPixels',
    ].forEach((key) => {
      expect(row[key]).toBeUndefined();
    });
  });

  it('rejects a stored URL from a host that is not allow-listed', async () => {
    const { executor, inserted } = executorWith({
      snapshotImageUrls: [
        'https://evil.example.com/a.jpg',
        'http://cf.cjdropshipping.com/insecure.jpg',
      ],
      feedImageUrl: 'https://cf.cjdropshipping.com/quick/product/feed.jpg',
    });

    const result = await projectSupplierMediaForProduct(executor as never, {
      productId: PRODUCT_ID,
      candidateId: CANDIDATE_ID,
      actorId: 'actor-1',
      rights: RIGHTS,
    });

    // Both snapshot urls are rejected, so it falls through to the feed image.
    expect(result.source).toBe('FEED_SNAPSHOT');
    expect(inserted[0]).toEqual([
      expect.objectContaining({
        sourceUrl: 'https://cf.cjdropshipping.com/quick/product/feed.jpg',
        observedAt: EVALUATED_AT,
      }),
    ]);
  });

  it('falls back to the single feed-snapshot image when no detail evidence exists', async () => {
    const { executor } = executorWith({
      feedImageUrl: 'https://cf.cjdropshipping.com/quick/product/feed.jpg',
    });

    const result = await projectSupplierMediaForProduct(executor as never, {
      productId: PRODUCT_ID,
      candidateId: CANDIDATE_ID,
      actorId: 'actor-1',
      rights: RIGHTS,
    });

    expect(result).toEqual({
      inserted: 1,
      skipped: 0,
      source: 'FEED_SNAPSHOT',
    });
  });

  it('does not duplicate a URL already recorded for the product', async () => {
    const { executor, inserted } = executorWith({
      snapshotImageUrls: [
        'https://cf.cjdropshipping.com/quick/product/a.jpg',
        'https://cf.cjdropshipping.com/quick/product/b.jpg',
      ],
      existingUrls: ['https://cf.cjdropshipping.com/quick/product/a.jpg'],
    });

    const result = await projectSupplierMediaForProduct(executor as never, {
      productId: PRODUCT_ID,
      candidateId: CANDIDATE_ID,
      actorId: 'actor-1',
      rights: RIGHTS,
    });

    expect(result).toEqual({
      inserted: 1,
      skipped: 1,
      source: 'DETAIL_EVIDENCE',
    });
    expect(inserted[0]).toHaveLength(1);
  });

  it('writes nothing and says so when there is no observed image at all', async () => {
    const { executor, inserted } = executorWith({});

    const result = await projectSupplierMediaForProduct(executor as never, {
      productId: PRODUCT_ID,
      candidateId: CANDIDATE_ID,
      actorId: 'actor-1',
      rights: RIGHTS,
    });

    expect(result).toEqual({ inserted: 0, skipped: 0, source: 'NONE' });
    expect(inserted).toEqual([]);
  });
});
