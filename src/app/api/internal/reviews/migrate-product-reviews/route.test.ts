// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  default: () => ({ marker: 'db' }),
  isDatabaseConfigured: vi.fn(() => true),
}));

vi.mock('@/modules/reviews/migrate-product-reviews', () => ({
  migrateProductReviews: vi.fn(),
  readExistingReviewTables: vi.fn(),
}));

/* eslint-disable import/first */
import { NextRequest } from 'next/server';
import { isDatabaseConfigured } from '@/lib/db/client';
import {
  migrateProductReviews,
  readExistingReviewTables,
} from '@/modules/reviews/migrate-product-reviews';
import { GET, POST } from './route';
/* eslint-enable import/first */

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const SECRET = 'cron-secret-1';
const URL =
  'https://portal.example.com/api/internal/reviews/migrate-product-reviews';

const BOTH_PRESENT = { productReviews: true, productReviewReplies: true };

const SUCCESS_RESULT = {
  ok: true,
  tablesExistedBefore: { productReviews: false, productReviewReplies: false },
  ddl: { statementsRun: 17, statementsSkippedAlreadyExists: 0 },
  migrationRecord: { createdAt: 1787337923216, inserted: true },
  tablesExistAfter: BOTH_PRESENT,
};

function request(
  method: 'GET' | 'POST',
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(URL, { method, headers });
}

function authorized(method: 'GET' | 'POST'): NextRequest {
  return request(method, { authorization: `Bearer ${SECRET}` });
}

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  asMock(isDatabaseConfigured).mockReturnValue(true);
  asMock(migrateProductReviews).mockResolvedValue(SUCCESS_RESULT);
  asMock(readExistingReviewTables).mockResolvedValue(BOTH_PRESENT);
});

afterEach(() => {
  delete process.env.CRON_SECRET;
  vi.clearAllMocks();
});

describe('POST /api/internal/reviews/migrate-product-reviews', () => {
  it('rejects a missing or wrong control secret with 401 and writes nothing', async () => {
    const missing = await POST(request('POST'));
    const wrong = await POST(request('POST', { authorization: 'Bearer nope' }));

    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(migrateProductReviews).not.toHaveBeenCalled();
  });

  it('refuses when the control secret is unset rather than falling open', async () => {
    delete process.env.CRON_SECRET;

    const response = await POST(authorized('POST'));

    expect(response.status).toBe(401);
    expect(migrateProductReviews).not.toHaveBeenCalled();
  });

  it('reports no-database-configured instead of attempting a write', async () => {
    asMock(isDatabaseConfigured).mockReturnValue(false);

    const response = await POST(authorized('POST'));

    expect(response.status).toBe(503);
    expect(migrateProductReviews).not.toHaveBeenCalled();
  });

  it('runs the migration and returns its result on an authorized request', async () => {
    const response = await POST(authorized('POST'));
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(SUCCESS_RESULT);
  });

  it('returns 500 without leaking internal detail when the migration throws', async () => {
    asMock(migrateProductReviews).mockRejectedValue(
      new Error('connection terminated unexpectedly'),
    );

    const response = await POST(authorized('POST'));
    const body: unknown = await response.json();

    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('connection terminated');
  });

  /** The response the workflow greps. A shape change silently defeats its check. */
  it('answers with a tablesExistAfter the workflow can assert on', async () => {
    const response = await POST(authorized('POST'));
    const text = await response.text();

    expect(text).toContain(
      '"tablesExistAfter":{"productReviews":true,"productReviewReplies":true}',
    );
  });

  it('never lets a migration response be cached', async () => {
    const response = await POST(authorized('POST'));

    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
});

describe('GET /api/internal/reviews/migrate-product-reviews', () => {
  /** Schema shape is not public information, so the read is gated too. */
  it('rejects an unauthenticated status read with 401', async () => {
    const response = await GET(request('GET'));

    expect(response.status).toBe(401);
    expect(readExistingReviewTables).not.toHaveBeenCalled();
  });

  it('reports the tables without writing anything', async () => {
    const response = await GET(authorized('GET'));
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, tablesExist: BOTH_PRESENT });
    expect(migrateProductReviews).not.toHaveBeenCalled();
  });

  it('returns 500 without leaking internal detail when the read throws', async () => {
    asMock(readExistingReviewTables).mockRejectedValue(
      new Error('relation "information_schema.tables" does not exist'),
    );

    const response = await GET(authorized('GET'));
    const body: unknown = await response.json();

    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('information_schema');
  });
});
