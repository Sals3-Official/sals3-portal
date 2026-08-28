import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearUsdToPhpRateCache, resolveUsdToPhpRate } from './fx';

/**
 * The buffer is now an argument rather than an env read, so these cases state
 * it. `1.5` is deliberately the value the live Market Rules funding buffer
 * carries (+1.50%), so the arithmetic below is the arithmetic production does.
 */
const BUFFER = 1.5;

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as unknown as Response;
}

describe('USD to PHP rate', () => {
  let errorLog: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    clearUsdToPhpRateCache();
    vi.stubEnv('CJ_USD_TO_PHP_RATE', '58');
    errorLog = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined) as ReturnType<typeof vi.spyOn>;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('adds the caller-supplied buffer on top of the published mid rate', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ rates: { PHP: 60 } })),
    );

    const rate = await resolveUsdToPhpRate(BUFFER);

    expect(rate.spot).toBe(60);
    expect(rate.effective).toBeCloseTo(60.9, 6); // 60 * 1.015
    expect(rate.bufferPercent).toBe(BUFFER);
    expect(rate.source).toBe('ecb-frankfurter');
    expect(rate.stale).toBe(false);
  });

  it('falls back to the second source when the first fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, false))
      .mockResolvedValueOnce(jsonResponse({ rates: { PHP: 61 } }));
    vi.stubGlobal('fetch', fetchMock);

    const rate = await resolveUsdToPhpRate(BUFFER);

    expect(rate.spot).toBe(61);
    expect(rate.source).toBe('open-er-api');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects an implausible rate rather than pricing on it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ rates: { PHP: 3 } })),
    );

    const rate = await resolveUsdToPhpRate(BUFFER);

    expect(rate.spot).toBe(58);
    expect(rate.source).toBe('configured-fallback');
    expect(rate.stale).toBe(true);
  });

  it('keeps serving the last good rate when a later refresh fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ rates: { PHP: 60 } })),
    );
    await resolveUsdToPhpRate(BUFFER);

    clearUsdToPhpRateCache();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ rates: { PHP: 60 } })),
    );
    const first = await resolveUsdToPhpRate(BUFFER);
    expect(first.spot).toBe(60);

    // Cache is warm, so a broken upstream is never even consulted.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const second = await resolveUsdToPhpRate(BUFFER);

    expect(second.spot).toBe(60);
    expect(second.stale).toBe(false);
  });

  it('uses the configured fallback when every source fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const rate = await resolveUsdToPhpRate(BUFFER);

    expect(rate.spot).toBe(58);
    expect(rate.effective).toBeCloseTo(58.87, 6); // 58 * 1.015
    expect(rate.stale).toBe(true);
    expect(errorLog).toHaveBeenCalled();
  });

  it('caches so repeated pricing does not re-fetch', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ rates: { PHP: 60 } }));
    vi.stubGlobal('fetch', fetchMock);

    await resolveUsdToPhpRate(BUFFER);
    await resolveUsdToPhpRate(BUFFER);
    await resolveUsdToPhpRate(BUFFER);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight refresh across concurrent callers', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ rates: { PHP: 60 } }));
    vi.stubGlobal('fetch', fetchMock);

    await Promise.all([
      resolveUsdToPhpRate(BUFFER),
      resolveUsdToPhpRate(BUFFER),
      resolveUsdToPhpRate(BUFFER),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('applies a changed buffer without waiting for the cache to expire', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ rates: { PHP: 60 } })),
    );
    await resolveUsdToPhpRate(BUFFER);

    // The point of re-applying rather than returning the stored `effective`:
    // a Market Rules edit reaches the next render, not the next cache expiry.
    const rate = await resolveUsdToPhpRate(3);

    expect(rate.effective).toBeCloseTo(61.8, 6); // 60 * 1.03
  });
});
