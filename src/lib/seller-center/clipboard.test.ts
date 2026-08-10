import { afterEach, describe, expect, it, vi } from 'vitest';
import copyToClipboard from './clipboard';

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
}

describe('copyToClipboard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves true when the clipboard write succeeds', async () => {
    stubClipboard(() => Promise.resolve());

    await expect(copyToClipboard('SALS3-P-1001')).resolves.toBe(true);
  });

  it('resolves false, never rejects, when the clipboard write is denied', async () => {
    stubClipboard(() => Promise.reject(new Error('Permission denied')));

    await expect(copyToClipboard('SALS3-P-1001')).resolves.toBe(false);
  });

  it('resolves false when navigator.clipboard is unavailable (insecure context)', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
    });

    await expect(copyToClipboard('SALS3-P-1001')).resolves.toBe(false);
  });
});
