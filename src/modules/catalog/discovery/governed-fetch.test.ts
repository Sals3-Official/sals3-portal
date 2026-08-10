import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  default: () => ({}),
  isDatabaseConfigured: () => true,
}));

vi.mock('./budget-repository', () => ({
  recordPointsInfo: vi.fn(),
  tryAcquireRequestSlot: vi.fn(),
}));

// eslint-disable-next-line import/first
import { CjApiError } from '@/services/cj/config';
// eslint-disable-next-line import/first
import { recordPointsInfo, tryAcquireRequestSlot } from './budget-repository';
// eslint-disable-next-line import/first
import createGovernedFetch from './governed-fetch';

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const BODY = {
  code: 200,
  message: 'ok',
  pointsInfo: { total: 50_000, usedToday: 120, remaining: 49_880 },
  data: null,
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(BODY), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('createGovernedFetch', () => {
  it('acquires a shared-limiter slot before every request and persists pointsInfo from the real response', async () => {
    asMock(tryAcquireRequestSlot).mockResolvedValue(true);

    const governed = createGovernedFetch('connection-1');
    const response = await governed('https://example.com/product/list');

    expect(tryAcquireRequestSlot).toHaveBeenCalledWith(
      expect.anything(),
      'connection-1',
    );
    expect(recordPointsInfo).toHaveBeenCalledWith(
      expect.anything(),
      'connection-1',
      BODY.pointsInfo,
    );
    // The caller still reads the full body - observation never consumes it.
    await expect(response.json()).resolves.toEqual(BODY);
  });

  it('fails as rate-limited when no slot arrives within the bounded wait - never a sleep-until-refill', async () => {
    vi.useFakeTimers();
    asMock(tryAcquireRequestSlot).mockResolvedValue(false);

    const governed = createGovernedFetch('connection-1');
    const pending = governed('https://example.com/product/list');
    const assertion = expect(pending).rejects.toThrow(CjApiError);

    await vi.advanceTimersByTimeAsync(11_000);
    await assertion;

    expect(global.fetch).not.toHaveBeenCalled();
    expect(recordPointsInfo).not.toHaveBeenCalled();
  });

  it('keeps working when the response is not JSON - nothing recorded, body passed through', async () => {
    asMock(tryAcquireRequestSlot).mockResolvedValue(true);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('plain text', { status: 200 })),
    );

    const governed = createGovernedFetch('connection-1');
    const response = await governed('https://example.com/health');

    expect(recordPointsInfo).not.toHaveBeenCalled();
    await expect(response.text()).resolves.toBe('plain text');
  });
});
