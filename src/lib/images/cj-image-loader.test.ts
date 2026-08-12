import { describe, expect, it } from 'vitest';
import cjImageLoader from './cj-image-loader';

/** A real `cf.cjdropshipping.com` object path, verified reachable 2026-08-13. */
const CJ_IMAGE =
  'https://cf.cjdropshipping.com/quick/product/66be425f-7a6c-483f-889b-ff43c4d9bb2d.jpg';

describe('cjImageLoader', () => {
  it('asks CJ CDN to resize and re-encode an allow-listed address', () => {
    const result = new URL(cjImageLoader({ src: CJ_IMAGE, width: 80 }));

    expect(result.searchParams.get('x-oss-process')).toBe(
      'image/resize,w_80/format,webp/quality,q_75',
    );
    expect(result.origin + result.pathname).toBe(CJ_IMAGE);
  });

  it('carries an explicit quality through instead of the default', () => {
    const result = new URL(
      cjImageLoader({ src: CJ_IMAGE, width: 40, quality: 60 }),
    );

    expect(result.searchParams.get('x-oss-process')).toBe(
      'image/resize,w_40/format,webp/quality,q_60',
    );
  });

  it('honours the second allow-listed host', () => {
    const result = cjImageLoader({
      src: 'https://oss-cf.cjdropshipping.com/product/a.jpg',
      width: 96,
    });

    expect(result).toContain('x-oss-process=');
  });

  it('replaces an existing instruction rather than appending a second one', () => {
    const result = new URL(
      cjImageLoader({
        src: `${CJ_IMAGE}?x-oss-process=image/resize,w_2000`,
        width: 40,
      }),
    );

    expect(result.searchParams.getAll('x-oss-process')).toEqual([
      'image/resize,w_40/format,webp/quality,q_75',
    ]);
  });

  it('preserves an unrelated query string already on the address', () => {
    const result = new URL(
      cjImageLoader({ src: `${CJ_IMAGE}?v=7`, width: 40 }),
    );

    expect(result.searchParams.get('v')).toBe('7');
    expect(result.searchParams.get('x-oss-process')).not.toBeNull();
  });

  /**
   * The loader is global, so it also receives the brand marks in the sidebar and
   * the auth screens. Rewriting those would point them at a CJ host that has
   * never held them.
   */
  it('returns a local public path untouched', () => {
    expect(cjImageLoader({ src: '/brand/sals3-mark.png', width: 96 })).toBe(
      '/brand/sals3-mark.png',
    );
    expect(
      cjImageLoader({
        src: '/suppliers/cj-dropshipping-logo-white.svg',
        width: 24,
      }),
    ).toBe('/suppliers/cj-dropshipping-logo-white.svg');
  });

  it('returns a non-allow-listed remote address untouched, never proxied', () => {
    [
      'https://evil.example.com/c.jpg',
      // Lookalike hostnames: a suffix/prefix match would let these through.
      'https://cf.cjdropshipping.com.evil.example.com/c.jpg',
      'https://notcf.cjdropshipping.com/c.jpg',
      // Plain http on an otherwise allow-listed host.
      'http://cf.cjdropshipping.com/a.jpg',
    ].forEach((src) => {
      expect(cjImageLoader({ src, width: 80 })).toBe(src);
    });
  });
});
