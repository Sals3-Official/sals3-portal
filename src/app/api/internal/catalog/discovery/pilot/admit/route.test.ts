// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  default: () => ({}),
  isDatabaseConfigured: () => true,
}));

vi.mock('@/modules/catalog/discovery/pilot-admission', () => ({
  default: vi.fn(),
}));

// eslint-disable-next-line import/first
import { NextRequest } from 'next/server';
// eslint-disable-next-line import/first
import admitPilotCandidates from '@/modules/catalog/discovery/pilot-admission';
// eslint-disable-next-line import/first
import { POST } from './route';

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const SECRET = 'control-secret-1';
const URL =
  'https://portal.example.com/api/internal/catalog/discovery/pilot/admit';

function request(headers: Record<string, string>, body = '{}'): NextRequest {
  return new NextRequest(URL, { method: 'POST', body, headers });
}

function authorized(body = '{}'): NextRequest {
  return request({ authorization: `Bearer ${SECRET}` }, body);
}

beforeEach(() => {
  process.env.DISCOVERY_CONTROL_SECRET = SECRET;
  asMock(admitPilotCandidates).mockResolvedValue({
    admitted: 600,
    dispatched: 600,
    failed: 0,
    paidCount: 0,
    limit: 2000,
    capReached: false,
  });
});

afterEach(() => {
  delete process.env.DISCOVERY_CONTROL_SECRET;
  vi.clearAllMocks();
});

describe('POST /api/internal/catalog/discovery/pilot/admit', () => {
  it('defaults to one rolling wave batch', async () => {
    const response = await POST(authorized());

    expect(response.status).toBe(200);
    expect(admitPilotCandidates).toHaveBeenCalledWith({ limit: 600 });
  });

  it('rejects a limit larger than one wave', async () => {
    const response = await POST(authorized(JSON.stringify({ limit: 601 })));

    expect(response.status).toBe(400);
    expect(admitPilotCandidates).not.toHaveBeenCalled();
  });
});
