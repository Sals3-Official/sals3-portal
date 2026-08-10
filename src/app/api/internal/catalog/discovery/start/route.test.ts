// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  default: () => ({}),
  isDatabaseConfigured: () => true,
}));

vi.mock('@/modules/catalog/discovery/control', () => ({
  default: vi.fn(),
}));

// eslint-disable-next-line import/first
import { NextRequest } from 'next/server';
// eslint-disable-next-line import/first
import applyDiscoveryControl from '@/modules/catalog/discovery/control';
// eslint-disable-next-line import/first
import { POST } from './route';

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const SECRET = 'control-secret-1';

function request(headers: Record<string, string>): NextRequest {
  return new NextRequest(
    'https://portal.example.com/api/internal/catalog/discovery/start',
    { method: 'POST', body: '{}', headers },
  );
}

function result(chainDispatched: boolean) {
  return {
    supplierConnectionId: 'connection-1',
    action: 'START',
    runState: 'RUNNING',
    cycleId: 'cycle-1',
    cycleCreated: true,
    chainDispatched,
  };
}

beforeEach(() => {
  process.env.DISCOVERY_CONTROL_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.DISCOVERY_CONTROL_SECRET;
  vi.clearAllMocks();
});

describe('POST /api/internal/catalog/discovery/start', () => {
  it('rejects a missing/wrong control secret with 401', async () => {
    const unauthorized = await POST(request({}));
    const wrong = await POST(request({ authorization: 'Bearer nope' }));

    expect(unauthorized.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(applyDiscoveryControl).not.toHaveBeenCalled();
  });

  it('returns 200 when the chain kick actually reached the queue', async () => {
    asMock(applyDiscoveryControl).mockResolvedValue([result(true)]);

    const response = await POST(request({ authorization: `Bearer ${SECRET}` }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({ ok: true }),
    );
  });

  it('returns 503 queue-publish-failed when the kick-off publish failed - the chain would otherwise silently never start', async () => {
    asMock(applyDiscoveryControl).mockResolvedValue([result(false)]);

    const response = await POST(request({ authorization: `Bearer ${SECRET}` }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({ ok: false, reason: 'queue-publish-failed' }),
    );
  });
});
