// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  default: () => ({ marker: 'db' }),
  isDatabaseConfigured: vi.fn(() => true),
}));

vi.mock('@/modules/catalog/taxonomy/v1-reference', () => ({
  getSals3CategoriesStatus: vi.fn(),
}));

/* eslint-disable import/first */
import { NextRequest } from 'next/server';
import { isDatabaseConfigured } from '@/lib/db/client';
import { getSals3CategoriesStatus } from '@/modules/catalog/taxonomy/v1-reference';
import { GET } from './route';
/* eslint-enable import/first */

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const SECRET = 'cron-secret-1';
const URL = 'https://portal.example.com/api/internal/catalog/taxonomy/status';

const STATUS = {
  total: 5595,
  v1Count: 5595,
  mirrorCount: 0,
  otherCount: 0,
  otherSampleCodes: [],
};

function request(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(URL, { method: 'GET', headers });
}

function authorized(): NextRequest {
  return request({ authorization: `Bearer ${SECRET}` });
}

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  asMock(isDatabaseConfigured).mockReturnValue(true);
  asMock(getSals3CategoriesStatus).mockResolvedValue(STATUS);
});

afterEach(() => {
  delete process.env.CRON_SECRET;
  vi.clearAllMocks();
});

describe('GET /api/internal/catalog/taxonomy/status', () => {
  it('rejects a missing or wrong control secret with 401 and reads nothing', async () => {
    const missing = await GET(request());
    const wrong = await GET(request({ authorization: 'Bearer nope' }));

    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(getSals3CategoriesStatus).not.toHaveBeenCalled();
  });

  it('refuses when the control secret is unset rather than falling open', async () => {
    delete process.env.CRON_SECRET;

    const response = await GET(authorized());

    expect(response.status).toBe(401);
    expect(getSals3CategoriesStatus).not.toHaveBeenCalled();
  });

  it('reports no-database-configured instead of attempting a read', async () => {
    asMock(isDatabaseConfigured).mockReturnValue(false);

    const response = await GET(authorized());

    expect(response.status).toBe(503);
    expect(getSals3CategoriesStatus).not.toHaveBeenCalled();
  });

  it('returns the real census on an authorized request', async () => {
    const response = await GET(authorized());
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, status: STATUS });
  });

  it('returns 500 without leaking internal detail when the read throws', async () => {
    asMock(getSals3CategoriesStatus).mockRejectedValue(
      new Error('connection terminated unexpectedly'),
    );

    const response = await GET(authorized());
    const body: unknown = await response.json();

    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('connection terminated');
  });
});
