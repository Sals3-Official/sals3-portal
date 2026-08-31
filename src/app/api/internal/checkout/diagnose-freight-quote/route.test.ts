// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/modules/checkout/diagnose-freight-quote', () => ({
  diagnoseFreightQuote: vi.fn(),
}));

/* eslint-disable import/first */
import { NextRequest } from 'next/server';
import { diagnoseFreightQuote } from '@/modules/checkout/diagnose-freight-quote';
import { GET } from './route';
/* eslint-enable import/first */

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const SECRET = 'cron-secret-1';
const BASE =
  'https://portal.example.com/api/internal/checkout/diagnose-freight-quote';

function request(
  query: string,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(`${BASE}${query}`, { headers });
}

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  asMock(diagnoseFreightQuote).mockReset();
});

afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe('GET /api/internal/checkout/diagnose-freight-quote', () => {
  it('rejects a missing or wrong control secret with 401', async () => {
    const missing = await GET(request('?productSlug=jacket'));
    const wrong = await GET(
      request('?productSlug=jacket', { authorization: 'Bearer nope' }),
    );

    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(diagnoseFreightQuote).not.toHaveBeenCalled();
  });

  it('refuses when the control secret is unset rather than falling open', async () => {
    delete process.env.CRON_SECRET;

    const response = await GET(
      request('?productSlug=jacket', { authorization: `Bearer ${SECRET}` }),
    );

    expect(response.status).toBe(401);
    expect(diagnoseFreightQuote).not.toHaveBeenCalled();
  });

  it('requires a product slug before doing anything', async () => {
    const response = await GET(
      request('', { authorization: `Bearer ${SECRET}` }),
    );

    expect(response.status).toBe(400);
    expect(diagnoseFreightQuote).not.toHaveBeenCalled();
  });

  it('runs the diagnosis with the query parameters given, defaulting country to PH', async () => {
    asMock(diagnoseFreightQuote).mockResolvedValue({ ok: true });

    await GET(
      request('?productSlug=jacket&variantId=v1', {
        authorization: `Bearer ${SECRET}`,
      }),
    );

    expect(diagnoseFreightQuote).toHaveBeenCalledWith({
      productSlug: 'jacket',
      variantId: 'v1',
      destinationCountry: 'PH',
    });
  });

  it('honours an explicit country', async () => {
    asMock(diagnoseFreightQuote).mockResolvedValue({ ok: true });

    await GET(
      request('?productSlug=jacket&country=FJ', {
        authorization: `Bearer ${SECRET}`,
      }),
    );

    expect(diagnoseFreightQuote).toHaveBeenCalledWith(
      expect.objectContaining({ destinationCountry: 'FJ' }),
    );
  });

  it('returns whatever the diagnosis reports, whether or not it succeeded', async () => {
    asMock(diagnoseFreightQuote).mockResolvedValue({
      ok: false,
      step: 'cj-product-query',
      message: 'boom',
    });

    const response = await GET(
      request('?productSlug=jacket', { authorization: `Bearer ${SECRET}` }),
    );
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: false,
      step: 'cj-product-query',
      message: 'boom',
    });
  });

  it('returns 500 without leaking internal detail when diagnosis itself throws', async () => {
    asMock(diagnoseFreightQuote).mockRejectedValue(
      new Error('connection terminated unexpectedly'),
    );

    const response = await GET(
      request('?productSlug=jacket', { authorization: `Bearer ${SECRET}` }),
    );
    const body: unknown = await response.json();

    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('connection terminated');
  });

  it('never lets a diagnosis response be cached', async () => {
    asMock(diagnoseFreightQuote).mockResolvedValue({ ok: true });

    const response = await GET(
      request('?productSlug=jacket', { authorization: `Bearer ${SECRET}` }),
    );

    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
});
