import { describe, expect, it } from 'vitest';
import formatCjCreateTime from './time-format';

describe('formatCjCreateTime', () => {
  it('renders the documented yyyy-MM-dd hh:mm:ss wire format in UTC by default', () => {
    expect(formatCjCreateTime(Date.UTC(2026, 7, 11, 9, 5, 30))).toBe(
      '2026-08-11 09:05:30',
    );
  });

  it('renders midnight as 00, never 24', () => {
    expect(formatCjCreateTime(Date.UTC(2026, 0, 1, 0, 0, 0))).toBe(
      '2026-01-01 00:00:00',
    );
  });

  it('honors an explicit timezone (the configurable, probe-gated assumption)', () => {
    // 2026-08-11 00:30 UTC is 10:30 the same day in Sydney (AEST, UTC+10).
    expect(
      formatCjCreateTime(Date.UTC(2026, 7, 11, 0, 30, 0), 'Australia/Sydney'),
    ).toBe('2026-08-11 10:30:00');
  });
});
