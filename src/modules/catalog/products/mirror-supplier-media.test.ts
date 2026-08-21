// @vitest-environment node
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/db/client', () => ({
  default: () => ({ marker: 'db' }),
  isDatabaseConfigured: () => true,
}));

vi.mock('@/lib/storage/r2-client', () => ({
  readR2Config: vi.fn(() => ({
    bucket: 'sals3-media',
    publicBaseUrl: 'https://media.example-r2.dev',
    accountId: 'acct',
    accessKeyId: 'key',
    secretAccessKey: 'secret',
  })),
  getR2Client: vi.fn(() => ({ send: vi.fn().mockResolvedValue({}) })),
}));

vi.mock('@/lib/storage/r2-url', () => ({
  r2PublicUrlForKey: (base: string, key: string) => `${base}/${key}`,
  r2PublicImageUrl: { parse: (value: string) => value },
}));

vi.mock('./image-upload-pipeline', () => ({
  MAX_UPLOAD_BYTES: 5 * 1024 * 1024,
  OUTPUT_CONTENT_TYPE: 'image/webp',
  prepareUploadedImage: vi.fn(async () => ({
    ok: true,
    buffer: Buffer.from('webp-bytes'),
    width: 800,
    height: 800,
  })),
}));

/* eslint-disable import/first */
import { getR2Client, readR2Config } from '@/lib/storage/r2-client';
import mirrorSupplierMediaForProduct from './mirror-supplier-media';
import { prepareUploadedImage } from './image-upload-pipeline';
/* eslint-enable import/first */

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const CJ_URL = 'https://cf.cjdropshipping.com/photo/a.jpg';

/**
 * A db whose `select().from().where().limit()` chain returns queued results in
 * order, and whose `update()` chain records what it was asked to write.
 */
function fakeDb(selectResults: unknown[][]) {
  const queue = [...selectResults];
  const updates: Record<string, unknown>[] = [];
  const chain = () => {
    const link: Record<string, unknown> = {};

    ['from', 'innerJoin', 'where'].forEach((key) => {
      link[key] = () => link;
    });
    link.limit = () => Promise.resolve(queue.shift() ?? []);

    return link;
  };

  const db = {
    select: () => chain(),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updates.push(values);

        return { where: () => Promise.resolve(undefined) };
      },
    }),
  };

  return { db, updates };
}

function okFetch(bytes = 12) {
  return vi.fn(
    async () =>
      new Response(new Uint8Array(bytes), {
        status: 200,
        headers: { 'content-length': String(bytes) },
      }),
  ) as unknown as typeof fetch;
}

describe('mirrorSupplierMediaForProduct', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readR2Config).mockReturnValue({
      bucket: 'sals3-media',
      publicBaseUrl: 'https://media.example-r2.dev',
    } as never);
    vi.mocked(prepareUploadedImage).mockResolvedValue({
      ok: true,
      buffer: Buffer.from('webp-bytes'),
      width: 800,
      height: 800,
    } as never);
  });

  it('stores the bytes and records where, without touching source_url', async () => {
    const { db, updates } = fakeDb([
      [{ id: 'media-1', sourceUrl: CJ_URL }],
      [],
    ]);

    const result = await mirrorSupplierMediaForProduct({
      productId: PRODUCT_ID,
      db: db as never,
      fetchImpl: okFetch(),
    });

    expect(result.mirrored).toBe(1);
    expect(result.failures).toEqual([]);
    expect(updates[0]?.storedUrl).toMatch(
      /^https:\/\/media\.example-r2\.dev\/supplier-media\//u,
    );
    expect(updates[0]?.storedAt).toBeInstanceOf(Date);
    // Provenance is untouched (ADR-011 §6), and so is the rights decision.
    expect(updates[0]).not.toHaveProperty('sourceUrl');
    expect(updates[0]).not.toHaveProperty('rightsBasis');
    expect(updates[0]).not.toHaveProperty('reviewState');
  });

  /**
   * A stored URL is still an address this server is about to open. The projection
   * allow-listed it on the way in; that is not a reason to trust it on the way
   * out (rule 32 — no user-influenced value decides what the server fetches).
   */
  it('refuses to fetch an address outside the CJ host allow-list', async () => {
    const { db, updates } = fakeDb([
      [{ id: 'media-1', sourceUrl: 'https://evil.example.com/a.jpg' }],
    ]);
    const fetchImpl = okFetch();

    const result = await mirrorSupplierMediaForProduct({
      productId: PRODUCT_ID,
      db: db as never,
      fetchImpl,
    });

    expect(result.failures).toEqual([
      { mediaId: 'media-1', reason: 'HOST_NOT_ALLOWED' },
    ]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('refuses a file larger than the upload ceiling before decoding it', async () => {
    const { db, updates } = fakeDb([[{ id: 'media-1', sourceUrl: CJ_URL }]]);
    const oversized = vi.fn(
      async () =>
        new Response(new Uint8Array(1), {
          status: 200,
          headers: { 'content-length': String(9 * 1024 * 1024) },
        }),
    ) as unknown as typeof fetch;

    const result = await mirrorSupplierMediaForProduct({
      productId: PRODUCT_ID,
      db: db as never,
      fetchImpl: oversized,
    });

    expect(result.failures).toEqual([
      { mediaId: 'media-1', reason: 'TOO_LARGE' },
    ]);
    expect(prepareUploadedImage).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('reports a CDN failure without writing anything', async () => {
    const { db, updates } = fakeDb([[{ id: 'media-1', sourceUrl: CJ_URL }]]);
    const failing = vi.fn(async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;

    const result = await mirrorSupplierMediaForProduct({
      productId: PRODUCT_ID,
      db: db as never,
      fetchImpl: failing,
    });

    expect(result.failures).toEqual([
      { mediaId: 'media-1', reason: 'FETCH_FAILED' },
    ]);
    expect(updates).toHaveLength(0);
  });

  it('reports a file the image pipeline refuses', async () => {
    const { db, updates } = fakeDb([[{ id: 'media-1', sourceUrl: CJ_URL }]]);

    vi.mocked(prepareUploadedImage).mockResolvedValue({
      ok: false,
      reason: 'UNSUPPORTED_FILE_TYPE',
    } as never);

    const result = await mirrorSupplierMediaForProduct({
      productId: PRODUCT_ID,
      db: db as never,
      fetchImpl: okFetch(),
    });

    expect(result.failures).toEqual([
      { mediaId: 'media-1', reason: 'NOT_AN_IMAGE' },
    ]);
    expect(updates).toHaveLength(0);
  });

  /**
   * The `(product_id, checksum)` unique index would otherwise turn a product
   * carrying the same photo twice into a failure. Reusing the copy also means the
   * duplicate costs no storage.
   */
  it('reuses a copy this product already holds instead of storing it twice', async () => {
    const { db, updates } = fakeDb([
      [{ id: 'media-2', sourceUrl: CJ_URL }],
      [{ storedUrl: 'https://media.example-r2.dev/supplier-media/x/abc.webp' }],
    ]);
    const client = { send: vi.fn().mockResolvedValue({}) };

    vi.mocked(getR2Client).mockReturnValue(client as never);

    const result = await mirrorSupplierMediaForProduct({
      productId: PRODUCT_ID,
      db: db as never,
      fetchImpl: okFetch(),
    });

    expect(client.send).not.toHaveBeenCalled();
    expect(result.mirrored).toBe(0);
    expect(result.skipped).toBe(1);
    expect(updates[0]?.storedUrl).toBe(
      'https://media.example-r2.dev/supplier-media/x/abc.webp',
    );
    // No second checksum on the duplicate row — that is what the unique index
    // exists to prevent.
    expect(updates[0]?.checksum).toBeNull();
  });

  it('does nothing at all when there is nothing left to mirror', async () => {
    const { db, updates } = fakeDb([[]]);
    const fetchImpl = okFetch();

    const result = await mirrorSupplierMediaForProduct({
      productId: PRODUCT_ID,
      db: db as never,
      fetchImpl,
    });

    expect(result).toEqual({ mirrored: 0, skipped: 0, failures: [] });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('reports storage as unconfigured rather than pretending to copy', async () => {
    const { db, updates } = fakeDb([[{ id: 'media-1', sourceUrl: CJ_URL }]]);

    vi.mocked(readR2Config).mockReturnValue(null);

    const result = await mirrorSupplierMediaForProduct({
      productId: PRODUCT_ID,
      db: db as never,
      fetchImpl: okFetch(),
    });

    expect(result.failures).toEqual([
      { mediaId: 'media-1', reason: 'STORAGE_FAILED' },
    ]);
    expect(updates).toHaveLength(0);
  });
});

/**
 * Cost discipline, read from the module's own source: this reads CJ's CDN, never
 * its API, so it spends no points (ADR-017) — and it must never become reachable
 * from a render.
 */
describe('mirror cost discipline', () => {
  const SOURCE = readFileSync(
    'src/modules/catalog/products/mirror-supplier-media.ts',
    'utf8',
  );

  it('never calls the CJ API or its token manager', () => {
    expect(SOURCE).not.toMatch(/CjTokenManager|getAccessToken|postCjJson/u);
    expect(SOURCE).not.toMatch(/developers\.cjdropshipping/u);
  });

  it('bounds a single run', () => {
    expect(SOURCE).toMatch(/MAX_MIRRORED_PER_PRODUCT/u);
    expect(SOURCE).toMatch(/AbortSignal\.timeout/u);
  });
});
