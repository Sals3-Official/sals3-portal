import { describe, expect, it } from 'vitest';
import { parsePageParam, resolvePageWindow } from './pagination';

describe('parsePageParam', () => {
  it('parses a positive integer', () => {
    expect(parsePageParam('7')).toBe(7);
  });

  it('falls back to page 1 for anything that is not a positive integer', () => {
    expect(parsePageParam(undefined)).toBe(1);
    expect(parsePageParam('')).toBe(1);
    expect(parsePageParam('0')).toBe(1);
    expect(parsePageParam('-3')).toBe(1);
    expect(parsePageParam('2.5')).toBe(1);
    expect(parsePageParam('abc')).toBe(1);
    expect(parsePageParam('1e999')).toBe(1);
  });
});

describe('resolvePageWindow', () => {
  it('offsets by whole pages', () => {
    expect(resolvePageWindow(86_605, 3, 100)).toEqual({
      page: 3,
      totalPages: 867,
      offset: 200,
      pageSize: 100,
      total: 86_605,
    });
  });

  it('reaches the last partial page of a large tab', () => {
    const window = resolvePageWindow(86_605, 867, 100);

    expect(window.offset).toBe(86_600);
    expect(window.page).toBe(867);
  });

  it('clamps a page past the end onto the last page with rows', () => {
    expect(resolvePageWindow(250, 9999, 100)).toMatchObject({
      page: 3,
      totalPages: 3,
      offset: 200,
    });
  });

  it('keeps one page for an empty result rather than page 1 of 0', () => {
    expect(resolvePageWindow(0, 1, 100)).toMatchObject({
      page: 1,
      totalPages: 1,
      offset: 0,
      total: 0,
    });
  });

  it('treats a negative total and a zero page size as their safe floors', () => {
    expect(resolvePageWindow(-5, 1, 0)).toMatchObject({
      page: 1,
      totalPages: 1,
      offset: 0,
      pageSize: 1,
      total: 0,
    });
  });
});
