// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  default: () => ({ marker: 'db' }),
  isDatabaseConfigured: vi.fn(() => true),
}));

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));

// The tag is a plain string, but importing the cache module pulls the whole
// server-only read model in with it. Mocked for the same reason every sibling
// route test mocks it.
vi.mock('@/lib/storefront/catalog-cache', () => ({
  STOREFRONT_CATALOG_TAG: 'storefront-catalog',
}));

vi.mock('@/modules/reviews/repository', () => ({ submitReview: vi.fn() }));

/* eslint-disable import/first */
import { isDatabaseConfigured } from '@/lib/db/client';
import { resetRateLimiter } from '@/lib/rate-limit';
import { submitReview } from '@/modules/reviews/repository';
import { POST } from './route';
/* eslint-enable import/first */

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const TOKEN = 'storefront-token-1';
const URL = 'https://portal.example.com/api/storefront/reviews';

const BODY = {
  orderLineId: '11111111-1111-4111-8111-111111111111',
  rating: 5,
  body: 'Fits exactly like the size chart said.',
  attribution: { kind: 'named', displayName: 'Hezekiah A.' },
};

function request(
  headers: Record<string, string>,
  body: unknown = BODY,
): Request {
  return new Request(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function authorized(body: unknown = BODY): Request {
  return request(
    { authorization: `Bearer ${TOKEN}`, 'x-buyer-email': 'buyer@example.com' },
    body,
  );
}

beforeEach(() => {
  process.env.SALS3_STOREFRONT_API_TOKEN = TOKEN;
  resetRateLimiter();
  asMock(isDatabaseConfigured).mockReturnValue(true);
  asMock(submitReview).mockResolvedValue({ ok: true, reviewId: 'review-1' });
});

afterEach(() => {
  delete process.env.SALS3_STOREFRONT_API_TOKEN;
  vi.clearAllMocks();
});

describe('POST /api/storefront/reviews', () => {
  it.each([
    ['no bearer token', {}],
    ['a wrong bearer token', { authorization: 'Bearer nope' }],
  ])('rejects %s with 401 and writes nothing', async (_label, headers) => {
    const response = await POST(
      request({ ...headers, 'x-buyer-email': 'buyer@example.com' }),
    );

    expect(response.status).toBe(401);
    expect(submitReview).not.toHaveBeenCalled();
  });

  /**
   * The header *is* the authorisation. Without it there is nothing to scope the
   * write to, so this must refuse rather than fall back to anything.
   */
  it.each([
    ['missing', {}],
    ['blank', { 'x-buyer-email': '   ' }],
    ['absurdly long', { 'x-buyer-email': `${'a'.repeat(250)}@example.com` }],
  ])('rejects a %s buyer identity with 400', async (_label, headers) => {
    const response = await POST(
      request({ authorization: `Bearer ${TOKEN}`, ...headers }),
    );

    expect(response.status).toBe(400);
    expect(submitReview).not.toHaveBeenCalled();
  });

  it('reports 503 when no database is configured instead of attempting a write', async () => {
    asMock(isDatabaseConfigured).mockReturnValue(false);

    const response = await POST(authorized());

    expect(response.status).toBe(503);
    expect(submitReview).not.toHaveBeenCalled();
  });

  it.each([
    ['not JSON at all', 'not json'],
    ['a rating above five', { ...BODY, rating: 6 }],
    ['a rating of zero', { ...BODY, rating: 0 }],
    ['a fractional rating', { ...BODY, rating: 4.5 }],
    [
      'no rating',
      { orderLineId: BODY.orderLineId, attribution: BODY.attribution },
    ],
    ['a non-uuid line id', { ...BODY, orderLineId: 'line-1' }],
    ['an over-long body', { ...BODY, body: 'x'.repeat(1001) }],
    [
      'an unknown attribution kind',
      { ...BODY, attribution: { kind: 'nickname' } },
    ],
  ])('rejects %s with 400 and writes nothing', async (_label, body) => {
    const response = await POST(authorized(body));

    expect(response.status).toBe(400);
    expect(submitReview).not.toHaveBeenCalled();
  });

  it('hands the verified header address to the domain, never a body field', async () => {
    await POST(authorized({ ...BODY, buyerEmail: 'attacker@example.com' }));

    expect(submitReview).toHaveBeenCalledWith(
      expect.objectContaining({ buyerEmail: 'buyer@example.com' }),
    );
  });

  it('answers 201 with the new review id', async () => {
    const response = await POST(authorized());

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ reviewId: 'review-1' });
  });

  /**
   * 404 rather than 403: an unknown line, someone else's line and an
   * undelivered line are one indistinguishable answer, and a 403 would confirm
   * the line exists.
   */
  it('answers 404 for an ineligible line', async () => {
    asMock(submitReview).mockResolvedValue({
      ok: false,
      reason: 'not_eligible',
    });

    const response = await POST(authorized());

    expect(response.status).toBe(404);
  });

  /** The buyer's own row, so saying so tells them nothing they did not do. */
  it('answers 409 for a line this buyer already reviewed', async () => {
    asMock(submitReview).mockResolvedValue({
      ok: false,
      reason: 'already_reviewed',
    });

    const response = await POST(authorized());

    expect(response.status).toBe(409);
  });

  it('throttles a buyer hammering the endpoint', async () => {
    const statuses: number[] = [];

    // Sequential by design: the limiter is stateful, so a parallel burst would
    // not exercise the bucket the way a real repeated submit does.
    for (let attempt = 0; attempt < 12; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop -- see above.
      statuses.push((await POST(authorized())).status);
    }

    expect(statuses).toContain(429);
  });

  it('never lets a review response be cached', async () => {
    const response = await POST(authorized());

    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('returns 503 without leaking internal detail when the write throws', async () => {
    asMock(submitReview).mockRejectedValue(
      new Error('relation "sals3_product_reviews" does not exist'),
    );

    const response = await POST(authorized());
    const payload: unknown = await response.json();

    expect(response.status).toBe(503);
    expect(JSON.stringify(payload)).not.toContain('sals3_product_reviews');
  });
});
