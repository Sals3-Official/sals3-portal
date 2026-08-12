// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  default: () => ({}),
  isDatabaseConfigured: () => true,
}));

vi.mock('@/modules/catalog/discovery/recheck-control', () => ({
  default: vi.fn(),
}));

// eslint-disable-next-line import/first
import { NextRequest } from 'next/server';
// eslint-disable-next-line import/first
import recheckPolicyVersionMismatches from '@/modules/catalog/discovery/recheck-control';
// eslint-disable-next-line import/first
import { POST } from './route';

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const SECRET = 'control-secret-1';
const URL =
  'https://portal.example.com/api/internal/catalog/evaluations/recheck-policy-version';

function request(headers: Record<string, string>, body = '{}'): NextRequest {
  return new NextRequest(URL, { method: 'POST', body, headers });
}

function authorized(body = '{}'): NextRequest {
  return request({ authorization: `Bearer ${SECRET}` }, body);
}

function result(failed = 0) {
  return {
    policyVersion: 'catalog-eval-policy-placeholder-v1+buyer-destination:v2',
    requeued: 600,
    results: [
      {
        supplierConnectionId: 'connection-1',
        requeued: 600,
        remaining: 86_000,
      },
    ],
    outbox: { dispatched: 600, failed },
  };
}

beforeEach(() => {
  process.env.DISCOVERY_CONTROL_SECRET = SECRET;
  asMock(recheckPolicyVersionMismatches).mockResolvedValue(result());
});

afterEach(() => {
  delete process.env.DISCOVERY_CONTROL_SECRET;
  vi.clearAllMocks();
});

describe('POST /api/internal/catalog/evaluations/recheck-policy-version', () => {
  it('rejects a missing or wrong control secret with 401 and does no work', async () => {
    const missing = await POST(request({}));
    const wrong = await POST(request({ authorization: 'Bearer nope' }));

    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(recheckPolicyVersionMismatches).not.toHaveBeenCalled();
  });

  it('defaults to a bounded batch rather than the whole backlog', async () => {
    const response = await POST(authorized());

    expect(response.status).toBe(200);
    expect(recheckPolicyVersionMismatches).toHaveBeenCalledWith({
      limit: 600,
      supplierConnectionId: undefined,
    });
  });

  it('accepts an explicit limit and connection', async () => {
    await POST(
      authorized(
        JSON.stringify({
          limit: 25,
          supplierConnectionId: '6aa82ace-e1bb-42cb-88b0-af5e0917d0f5',
        }),
      ),
    );

    expect(recheckPolicyVersionMismatches).toHaveBeenCalledWith({
      limit: 25,
      supplierConnectionId: '6aa82ace-e1bb-42cb-88b0-af5e0917d0f5',
    });
  });

  it('rejects a limit outside the bound, an unknown field, and a bad connection id', async () => {
    const tooBig = await POST(authorized(JSON.stringify({ limit: 601 })));
    const zero = await POST(authorized(JSON.stringify({ limit: 0 })));
    const unknown = await POST(authorized(JSON.stringify({ nope: 1 })));
    const badId = await POST(
      authorized(JSON.stringify({ supplierConnectionId: 'not-a-uuid' })),
    );

    [tooBig, zero, unknown, badId].forEach((response) => {
      expect(response.status).toBe(400);
    });

    expect(recheckPolicyVersionMismatches).not.toHaveBeenCalled();
  });

  it('reports an undispatched intent as a failure, never a partial success', async () => {
    asMock(recheckPolicyVersionMismatches).mockResolvedValue(result(3));

    const response = await POST(authorized());

    // Nothing else drains the outbox while discovery is paused, so an
    // unpublished intent would leave those rows stuck in QUEUED.
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      reason: 'queue-publish-failed',
    });
  });

  it('returns 500 without leaking internal detail when the recheck throws', async () => {
    asMock(recheckPolicyVersionMismatches).mockRejectedValue(
      new Error('connection terminated unexpectedly'),
    );

    const response = await POST(authorized());
    const body: unknown = await response.json();

    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('connection terminated');
  });
});
