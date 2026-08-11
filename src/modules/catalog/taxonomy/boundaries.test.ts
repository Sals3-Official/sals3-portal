import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PORTAL_ROLES } from '@/lib/auth/permissions';

import { authorizeCategoryGovernance } from './authorization';

/**
 * Repository guards for the category-mapping pilot's three hard boundaries:
 * zero supplier calls, no seller-facing mutation surface, and no market /
 * price / margin literal leaking into a taxonomy answer.
 *
 * These scan the module's real runtime source rather than asserting on
 * behaviour, because the failure mode being prevented is a *future edit*
 * quietly adding an import — something a behavioural test on today's code
 * would never catch.
 */

const MODULE_ROOT = join(__dirname);
const APP_ROOT = join(__dirname, '../../../app');

function collectSourceFiles(dir: string, skipTests: boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);

    if (entry.isDirectory()) return collectSourceFiles(full, skipTests);
    if (!/\.tsx?$/.test(entry.name)) return [];
    if (skipTests && /\.test\.tsx?$/.test(entry.name)) return [];

    return [full];
  });
}

describe('category mapping makes zero supplier calls', () => {
  /**
   * Anything that would reach CJ: the adapter, the governed fetch wrapper,
   * the raw CJ client modules, or a bare `fetch`. Mapping, resolution,
   * category-form and remap paths are local database reads only, so none of
   * these may appear in this module's runtime source.
   */
  const SUPPLIER_REACH_PATTERNS = [
    /CjSupplierAdapter/,
    /from\s+['"]@\/modules\/suppliers/,
    /from\s+['"]@\/lib\/cj\//,
    /from\s+['"]@\/modules\/catalog\/discovery\//,
    /\bfetch\s*\(/,
    /api2\.0/,
    /cjdropshipping/i,
  ];

  it('imports no supplier adapter and issues no network request', () => {
    const offenders = collectSourceFiles(MODULE_ROOT, true)
      .map((file) => ({ file, content: readFileSync(file, 'utf8') }))
      .filter(({ content }) =>
        SUPPLIER_REACH_PATTERNS.some((pattern) => pattern.test(content)),
      )
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it('parses no workbook at runtime and never reads the sibling vault', () => {
    const offenders = collectSourceFiles(MODULE_ROOT, true)
      .map((file) => ({ file, content: readFileSync(file, 'utf8') }))
      .filter(
        ({ content }) =>
          /\.xlsx/.test(content) || /sals3-ecommerce/.test(content),
      )
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });
});

describe('no market, price or margin literal enters a taxonomy answer', () => {
  const FORBIDDEN = [
    /(['"])(PH|AU|SG|ID)\1/,
    /\bmarginRate\b/,
    /\bpriceMinor\b/,
    /\bamountMinor\b/,
    /approved for sale/i,
  ];

  it('keeps commercial and market vocabulary out of this module', () => {
    const offenders = collectSourceFiles(MODULE_ROOT, true)
      .map((file) => ({ file, content: readFileSync(file, 'utf8') }))
      .filter(({ content }) =>
        FORBIDDEN.some((pattern) => pattern.test(content)),
      )
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });
});

describe('governance has no seller-facing surface', () => {
  it('is imported by nothing under src/app — no route, page or Server Action', () => {
    // `product-category` is included: it writes a real product row, so a
    // route reaching it would be a category mutation with no governance
    // authority behind it.
    const offenders = collectSourceFiles(APP_ROOT, false)
      .map((file) => ({ file, content: readFileSync(file, 'utf8') }))
      .filter(({ content }) =>
        /modules\/catalog\/taxonomy\/(governance|repository|product-category)/.test(
          content,
        ),
      )
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it('denies category governance to every portal role, including admin', () => {
    PORTAL_ROLES.forEach((role) => {
      expect(authorizeCategoryGovernance(role)).toEqual({
        allowed: false,
        reason: 'CATEGORY_GOVERNANCE_AUTHORITY_UNAVAILABLE',
        message: expect.any(String),
      });
    });
  });

  it('returns one byte-identical denial, naming no role, mapping or row', () => {
    const denials = PORTAL_ROLES.map((role) =>
      JSON.stringify(authorizeCategoryGovernance(role)),
    );

    expect(new Set(denials).size).toBe(1);
    PORTAL_ROLES.forEach((role) => {
      expect(denials[0]).not.toContain(role);
    });
  });
});

describe('database-unconfigured behaviour is honest and build-safe', () => {
  /**
   * `next build` imports every route module while collecting page data, so a
   * module that connects (or throws) at import time breaks the build in any
   * environment without `DATABASE_URL` — a preview deploy, CI, a fresh clone.
   * Importing this module must have no side effect; only running a query may
   * require configuration.
   */
  it('imports with no DATABASE_URL and does not connect', async () => {
    const previous = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    try {
      const [resolver, categoryForm, governance, repository] =
        await Promise.all([
          import('./resolver'),
          import('./category-form'),
          import('./governance'),
          import('./repository'),
        ]);

      expect(typeof resolver.resolveCategoryMapping).toBe('function');
      expect(typeof categoryForm.resolveCategoryFormContract).toBe('function');
      expect(typeof governance.proposeCategoryMapping).toBe('function');
      expect(typeof repository.findActiveMapping).toBe('function');
    } finally {
      if (previous !== undefined) process.env.DATABASE_URL = previous;
    }
  });

  it('never reads DATABASE_URL or reaches for a client itself', () => {
    const offenders = collectSourceFiles(MODULE_ROOT, true)
      .map((file) => ({ file, content: readFileSync(file, 'utf8') }))
      .filter(
        ({ content }) =>
          /DATABASE_URL/.test(content) || /\bgetDb\s*\(/.test(content),
      )
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });
});
