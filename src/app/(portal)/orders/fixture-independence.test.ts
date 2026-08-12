import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A fixture gate that looks fine in development collapses in production, where
 * `getActiveMarket()` correctly returns null. Keep both sides of `/orders`
 * structurally independent from that fixture, not merely visually correct in
 * a local dev render.
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

describe('Orders fixture independence', () => {
  it('imports nothing from the illustrative market fixture', () => {
    PRODUCTION_SOURCES.forEach((source) => {
      expect(source).not.toMatch(/from '@\/lib\/seller-center\/market-config'/);
    });
  });

  it('uses the tenant-scoped active-profile read', () => {
    PRODUCTION_SOURCES.forEach((source) => {
      expect(source).toContain('findActiveProfileForSeller');
      expect(source).toContain('session.sellerId');
      expect(source).toContain("readOrUnavailable('orders'");
    });
  });
});
