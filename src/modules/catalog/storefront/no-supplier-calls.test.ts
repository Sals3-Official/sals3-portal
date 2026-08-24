import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * The buyer request path must make **zero** supplier calls.
 *
 * Owner decision 2026-08-13: the public storefront reads the Sals3 catalogue
 * database and nothing else. Before this rewrite, every uncached
 * `/api/storefront/*` request issued a live CJ `/product/list` — the most
 * points-expensive route CJ documents — so a burst of anonymous traffic could
 * drain the budget ADR-013 §5 reserves for checkout and accepted-order
 * protection, and one purged supplier connection took the whole storefront
 * down with a 502.
 *
 * Walking the static import graph proves the adapter is unreachable from these
 * routes at all, including through a helper somebody adds later. A runtime spy
 * would only prove one code path did not call it on one test input. The rule
 * is enforced on imports precisely because the failure it prevents is a future
 * edit, not today's code.
 *
 * This mirrors `modules/catalog/products/no-supplier-calls.test.ts` on purpose:
 * two guards, one shape, both widened rather than relaxed when a new module
 * appears.
 */

const SRC_ROOT = resolve(__dirname, '../../..');
const APP_ROOT = resolve(SRC_ROOT, 'app/api/storefront');
const ENTRY_POINTS = [
  resolve(APP_ROOT, 'products/route.ts'),
  resolve(APP_ROOT, 'products/[id]/route.ts'),
  resolve(APP_ROOT, 'categories/route.ts'),
  resolve(APP_ROOT, 'categories/[slug]/products/route.ts'),
  resolve(__dirname, 'read-model.ts'),
];

/**
 * Anything that can reach the provider network, plus the two retired modules
 * that used to do it — naming them keeps a revert from quietly restoring the
 * old behaviour.
 */
const FORBIDDEN_PATH_FRAGMENTS = [
  'modules/suppliers/providers',
  'lib/cj/',
  'services/cj/',
  'modules/catalog/discovery/governed-fetch',
  'modules/catalog/candidates/evaluate',
  'lib/storefront/cj-feed',
  'lib/storefront/supplier-source',
  // The PHP storefront FX module: an outbound ECB fetch, and a currency this
  // contract no longer prices in.
  'lib/storefront/fx',
];

const IMPORT_PATTERN = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;

function resolveSpecifier(specifier: string, fromFile: string): string | null {
  if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return null;

  const base = specifier.startsWith('@/')
    ? resolve(SRC_ROOT, specifier.slice(2))
    : resolve(dirname(fromFile), specifier);

  const candidates = [
    `${base}.ts`,
    `${base}.tsx`,
    resolve(base, 'index.ts'),
    base,
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function collectImportGraph(entryPoints: string[]): Map<string, string[]> {
  const visited = new Map<string, string[]>();
  const queue = [...entryPoints];

  while (queue.length > 0) {
    const file = queue.shift() as string;

    if (visited.has(file) || !existsSync(file)) {
      // eslint-disable-next-line no-continue
      continue;
    }

    const source = readFileSync(file, 'utf8');
    const specifiers = [...source.matchAll(IMPORT_PATTERN)].map(
      (match) => match[1],
    );

    visited.set(file, specifiers);

    specifiers.forEach((specifier) => {
      const resolved = resolveSpecifier(specifier, file);

      if (resolved !== null && !resolved.endsWith('.test.ts')) {
        queue.push(resolved);
      }
    });
  }

  return visited;
}

describe('storefront API makes no supplier calls', () => {
  const graph = collectImportGraph(ENTRY_POINTS);

  it('reaches no supplier adapter, CJ client, or retired CJ feed', () => {
    const offenders: string[] = [];

    graph.forEach((specifiers, file) => {
      specifiers.forEach((specifier) => {
        if (
          FORBIDDEN_PATH_FRAGMENTS.some((fragment) =>
            specifier.includes(fragment),
          )
        ) {
          offenders.push(`${file} -> ${specifier}`);
        }
      });
    });

    expect(offenders).toEqual([]);
  });

  it('actually walked a non-trivial graph, so an empty result is meaningful', () => {
    // Guards the test itself: a resolver regression that silently found no
    // files would make the assertion above pass while proving nothing.
    expect(graph.size).toBeGreaterThan(3);
    expect([...graph.keys()].some((file) => file.includes('read-model'))).toBe(
      true,
    );
  });

  it('does reach the catalogue tables it is supposed to read', () => {
    const specifiers = [...graph.values()].flat();

    expect(specifiers.some((specifier) => specifier.includes('lib/db'))).toBe(
      true,
    );
  });

  /**
   * The screening table is seller-scoped and has no publication state, so
   * joining it into a public query would make "PUBLISHED-only in the same
   * WHERE" impossible. Supplier evidence reaches a buyer only after it has
   * been projected into `product_media_sources` / `product_offers`.
   */
  it('never reads candidate screening data in the buyer path', () => {
    const readModel = readFileSync(resolve(__dirname, 'read-model.ts'), 'utf8');

    expect(readModel).not.toContain('candidateEvaluations');
    expect(readModel).not.toContain('supplierCandidates');
    expect(readModel).not.toContain('supplierSnapshots');
  });
});
