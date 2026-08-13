import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * The draft flow must make **zero** supplier calls.
 *
 * Reading a saved snapshot must never trigger a CJ request (ADR-013 §1a), and
 * CJ points are a real, exhaustible budget reserved for checkout,
 * accepted-order protection, and live-offer reconciliation (ADR-013 §5). A
 * runtime spy would only prove that one code path did not call the adapter on
 * one test input; walking the static import graph proves the adapter is not
 * reachable from this module at all, including through a helper somebody adds
 * later.
 *
 * The rule is enforced on imports rather than on behaviour precisely because
 * the failure it prevents is a future edit, not today's code.
 */

const SRC_ROOT = resolve(__dirname, '../../..');
const ENTRY_POINTS = [
  resolve(__dirname, 'create-draft.ts'),
  resolve(__dirname, 'save-draft.ts'),
  resolve(__dirname, 'repository.ts'),
];

/** Anything that can reach the provider network, by path or by symbol. */
const FORBIDDEN_PATH_FRAGMENTS = [
  'modules/suppliers/providers',
  'lib/cj/',
  'modules/catalog/discovery/governed-fetch',
  'modules/catalog/candidates/evaluate',
  // Added 2026-08-13 with the module itself: it fetches CJ evidence, so the
  // draft flow reaching it would turn "read the saved snapshot" back into
  // three supplier requests — the exact inversion of ADR-013 §1a.
  'modules/catalog/candidates/capture-evidence',
];

/**
 * The only two `lib/cj/` modules the draft flow may reach, and the reason the
 * blanket ban above needs an exception at all.
 *
 * Draft creation projects supplier media, which means re-checking a stored
 * image address against the CJ host allow-list. That list lives in
 * `lib/cj/image-hosts.ts` and its Zod gate in `lib/cj/primitives.ts`, and
 * `media-projection.ts`'s own comment records why there must not be a fourth
 * copy: the list already has to agree across three places, and a duplicate here
 * would be the one that silently falls behind.
 *
 * Both are pure validators — no client, no adapter, no `fetch` — which is not
 * taken on trust: `keeps its own allowance honest` below asserts it against
 * their real source, so the exception cannot quietly grow into a network path.
 */
const ALLOWED_PURE_CJ_MODULES = ['lib/cj/primitives', 'lib/cj/image-hosts'];

function forbidden(specifier: string): boolean {
  if (ALLOWED_PURE_CJ_MODULES.some((allowed) => specifier.endsWith(allowed))) {
    return false;
  }

  return FORBIDDEN_PATH_FRAGMENTS.some((fragment) =>
    specifier.includes(fragment),
  );
}

const IMPORT_PATTERN = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;

function resolveSpecifier(specifier: string, fromFile: string): string | null {
  // Package imports (zod, drizzle-orm, next/...) are not project modules.
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

describe('candidate-to-draft flow makes no supplier calls', () => {
  const graph = collectImportGraph(ENTRY_POINTS);

  it('reaches no supplier adapter, CJ client, or governed provider fetch', () => {
    const offenders: string[] = [];

    graph.forEach((specifiers, file) => {
      specifiers.forEach((specifier) => {
        if (forbidden(specifier)) offenders.push(`${file} -> ${specifier}`);
      });
    });

    expect(offenders).toEqual([]);
  });

  it('keeps its own allowance honest: the permitted CJ modules cannot reach the network', () => {
    ALLOWED_PURE_CJ_MODULES.forEach((allowed) => {
      const file = resolve(SRC_ROOT, `${allowed}.ts`);

      expect(existsSync(file), `${allowed} must exist`).toBe(true);

      const source = readFileSync(file, 'utf8');
      const specifiers = [...source.matchAll(IMPORT_PATTERN)].map(
        (match) => match[1],
      );

      // No request of any kind, and no import that could make one — including
      // another `lib/cj/` module that is not itself on the allowance.
      expect(source).not.toMatch(/\bfetch\s*\(/);
      expect(specifiers.filter((specifier) => forbidden(specifier))).toEqual(
        [],
      );
    });
  });

  it('actually walked a non-trivial graph, so an empty result is meaningful', () => {
    // Guards the test itself: a resolver regression that silently found no
    // files would make the assertion above pass while proving nothing.
    expect(graph.size).toBeGreaterThan(3);
    expect([...graph.keys()].some((file) => file.includes('repository'))).toBe(
      true,
    );
  });

  it('does reach the persisted evidence it is supposed to read', () => {
    const specifiers = [...graph.values()].flat();

    expect(
      specifiers.some((specifier) =>
        specifier.includes('modules/catalog/candidates/repository'),
      ),
    ).toBe(true);
  });
});
