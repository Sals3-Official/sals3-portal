// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  default: () => ({ marker: 'db' }),
  isDatabaseConfigured: vi.fn(() => true),
}));

vi.mock('@/modules/catalog/taxonomy/seed-v1', () => ({
  seedSals3CategoriesV1: vi.fn(),
}));

/* eslint-disable import/first */
import { NextRequest } from 'next/server';
import { isDatabaseConfigured } from '@/lib/db/client';
import { seedSals3CategoriesV1 } from '@/modules/catalog/taxonomy/seed-v1';
import { POST } from './route';
/* eslint-enable import/first */

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const SECRET = 'cron-secret-1';
const URL = 'https://portal.example.com/api/internal/catalog/taxonomy/seed-v1';

const RESULT = { totalInExtract: 5595, inserted: 5595 };

function request(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(URL, { method: 'POST', headers });
}

function authorized(): NextRequest {
  return request({ authorization: `Bearer ${SECRET}` });
}

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  asMock(isDatabaseConfigured).mockReturnValue(true);
  asMock(seedSals3CategoriesV1).mockResolvedValue(RESULT);
});

afterEach(() => {
  delete process.env.CRON_SECRET;
  vi.clearAllMocks();
});

describe('POST /api/internal/catalog/taxonomy/seed-v1', () => {
  it('rejects a missing or wrong control secret with 401 and writes nothing', async () => {
    const missing = await POST(request());
    const wrong = await POST(request({ authorization: 'Bearer nope' }));

    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(seedSals3CategoriesV1).not.toHaveBeenCalled();
  });

  it('refuses when the control secret is unset rather than falling open', async () => {
    delete process.env.CRON_SECRET;

    const response = await POST(authorized());

    expect(response.status).toBe(401);
    expect(seedSals3CategoriesV1).not.toHaveBeenCalled();
  });

  it('reports no-database-configured instead of attempting a write', async () => {
    asMock(isDatabaseConfigured).mockReturnValue(false);

    const response = await POST(authorized());

    expect(response.status).toBe(503);
    expect(seedSals3CategoriesV1).not.toHaveBeenCalled();
  });

  it('seeds and returns the real result on an authorized request', async () => {
    const response = await POST(authorized());
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, result: RESULT });
  });

  it('returns 500 without leaking internal detail when the seed throws', async () => {
    asMock(seedSals3CategoriesV1).mockRejectedValue(
      new Error('connection terminated unexpectedly'),
    );

    const response = await POST(authorized());
    const body: unknown = await response.json();

    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('connection terminated');
  });
});
