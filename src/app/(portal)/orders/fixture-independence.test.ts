import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Temporary preview mode must remain independent of both market configuration
 * systems. It is intentionally visible before an account has any active
 * profile, but must not borrow values from the old market fixture.
 */
const ORDERS_DIR = join(process.cwd(), 'src/app/(portal)/orders');

function read(...segments: string[]): string {
  return readFileSync(join(...segments), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const PRODUCTION_SOURCES = [
  read(ORDERS_DIR, '(list)', 'page.tsx'),
  read(ORDERS_DIR, '[parcelId]', 'page.tsx'),
];

describe('Orders preview independence', () => {
  it('does not use either market configuration system as a gate', () => {
    PRODUCTION_SOURCES.forEach((source) => {
      expect(source).not.toMatch(/from '@\/lib\/seller-center\/market-config'/);
      expect(source).not.toContain('findActiveProfileForSeller');
    });
  });

  it('retains the server-side order permission check', () => {
    PRODUCTION_SOURCES.forEach((source) => {
      expect(source).toContain("requirePermission('order:read')");
    });
  });
});
