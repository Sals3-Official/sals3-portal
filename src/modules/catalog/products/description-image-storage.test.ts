import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DESCRIPTION_DOCUMENT_VERSION } from '@/lib/products/description-blocks';
import type { DescriptionDocument } from './description-document';
import { descriptionImagesAreStored } from './description-image-storage';

// `description-image-storage.ts` is `server-only`, which throws on import
// outside a Server Component. Hoisted by Vitest above the imports above.
vi.mock('server-only', () => ({}));

const PUBLIC_BASE = 'https://media.sals3.com';

function documentWith(url: string): DescriptionDocument {
  return {
    version: DESCRIPTION_DOCUMENT_VERSION,
    blocks: [{ type: 'image', url, alt: 'A hat' }],
  };
}

describe('description image write boundary', () => {
  const original = process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL;

  beforeEach(() => {
    process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL = PUBLIC_BASE;
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL;

      return;
    }

    process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL = original;
  });

  it('accepts an address under the configured bucket', () => {
    expect(
      descriptionImagesAreStored(
        documentWith(`${PUBLIC_BASE}/description-media/p/a.webp`),
      ),
    ).toBe(true);
  });

  it('refuses a foreign host', () => {
    // The whole point of the check: without it, a crafted save could point a
    // description image at a tracking pixel or somebody else's bandwidth.
    expect(
      descriptionImagesAreStored(
        documentWith('https://evil.example.com/a.webp'),
      ),
    ).toBe(false);
  });

  it('refuses a lookalike host that merely starts with the base', () => {
    expect(
      descriptionImagesAreStored(
        documentWith('https://media.sals3.com.attacker.test/a.webp'),
      ),
    ).toBe(false);
  });

  it('refuses every image once storage is unconfigured', () => {
    delete process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL;

    expect(
      descriptionImagesAreStored(
        documentWith(`${PUBLIC_BASE}/description-media/p/a.webp`),
      ),
    ).toBe(false);
  });

  it('leaves a text-only document alone when storage is unconfigured', () => {
    delete process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL;

    expect(
      descriptionImagesAreStored({
        version: DESCRIPTION_DOCUMENT_VERSION,
        blocks: [{ type: 'paragraph', text: 'Copy.' }],
      }),
    ).toBe(true);
  });
});
