// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  default: () => ({ marker: 'db' }),
  isDatabaseConfigured: vi.fn(() => true),
}));

vi.mock('@/modules/catalog/products/backfill-variant-dimensions', () => ({
  backfillVariantDimensions: vi.fn(),
}));

/* eslint-disable import/first */
import { NextRequest } from 'next/server';
import { isDatabaseConfigured } from '@/lib/db/client';
import { backfillVariantDimensions } from '@/modules/catalog/products/backfill-variant-dimensions';
import { POST } from './route';
/* eslint-enable import/first */

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const SECRET = 'cron-secret-1';
const URL =
  'https://portal.example.com/api/internal/catalog/products/backfill-variant-dimensions';

const RESULT = { variantsFilled: 12, variantsStillMissing: 3 };

function request(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(URL, { method: 'POST', headers });
}

function authorized(): NextRequest {
  return request({ authorization: `Bearer ${SECRET}` });
}

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  asMock(isDatabaseConfigured).mockReturnValue(true);
  asMock(backfillVariantDimensions).mockResolvedValue(RESULT);
});

afterEach(() => {
  delete process.env.CRON_SECRET;
  vi.clearAllMocks();
});

describe('POST /api/internal/catalog/products/backfill-variant-dimensions', () => {
  it('rejects a missing or wrong control secret with 401 and writes nothing', async () => {
    const missing = await POST(request());
    const wrong = await POST(request({ authorization: 'Bearer nope' }));

    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(backfillVariantDimensions).not.toHaveBeenCalled();
  });

  it('refuses when the control secret is unset rather than falling open', async () => {
    // An unset secret must never mean "no authentication required" — that is
    // the difference between a break-glass route and an open write endpoint.
    delete process.env.CRON_SECRET;

    const response = await POST(authorized());

    expect(response.status).toBe(401);
    expect(backfillVariantDimensions).not.toHaveBeenCalled();
  });

  it('reports no-database-configured instead of attempting a write', async () => {
    asMock(isDatabaseConfigured).mockReturnValue(false);

    const response = await POST(authorized());

    expect(response.status).toBe(503);
    expect(backfillVariantDimensions).not.toHaveBeenCalled();
  });

  it('runs the backfill and reports what it changed', async () => {
    const response = await POST(authorized());
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, ...RESULT });
  });

  it('returns 500 without leaking internal detail when the backfill throws', async () => {
    asMock(backfillVariantDimensions).mockRejectedValue(
      new Error('connection terminated unexpectedly'),
    );

    const response = await POST(authorized());
    const body: unknown = await response.json();

    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('connection terminated');
  });
});
