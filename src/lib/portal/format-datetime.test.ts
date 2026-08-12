import { describe, expect, it } from 'vitest';
import formatUtcDateTime from './format-datetime';

describe('formatUtcDateTime', () => {
  it('renders a fixed UTC string regardless of the machine timezone', () => {
    expect(formatUtcDateTime(new Date('2026-08-12T04:17:09.000Z'))).toBe(
      '2026-08-12 04:17 UTC',
    );
  });

  it('accepts an ISO string as well as a Date', () => {
    expect(formatUtcDateTime('2026-08-12T04:17:09.000Z')).toBe(
      '2026-08-12 04:17 UTC',
    );
  });

  /**
   * "Not captured", never a dash: a dash reads as "the value is empty", and
   * these fields are "we never recorded it".
   */
  it('falls back for absent and unparseable values', () => {
    expect(formatUtcDateTime(null)).toBe('Not captured');
    expect(formatUtcDateTime(undefined)).toBe('Not captured');
    expect(formatUtcDateTime('')).toBe('Not captured');
    expect(formatUtcDateTime('never')).toBe('Not captured');
    expect(formatUtcDateTime(null, 'Never checked')).toBe('Never checked');
  });
});
