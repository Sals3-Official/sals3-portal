// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Every internal break-glass route must import the module its own folder is
 * named after.
 *
 * ## Why this exists
 *
 * These routes are near-identical by design — authorize, check the database is
 * configured, lazily import one module, report what it did — so each new one is
 * written by copying the last. On 2026-08-28 that produced
 * `backfill-draft-offers/route.ts` still calling `migrateMediaPosition`: it
 * deployed, answered `401` without a credential exactly as it should, passed
 * `npm run verify`, and then **ran the wrong operation in production**. The
 * repair it was built for did not happen and the run reported success.
 *
 * Nothing could have caught it. There is no test per route — they are thin
 * wrappers — and the copy was correct in every respect a compiler or a linter
 * can see.
 *
 * ## What it checks, and what it deliberately does not
 *
 * Only that the folder name appears in an `import(...)` inside the file. It does
 * not check which exported function is called or what is done with the result:
 * this is a wiring assertion, not a behavioural one, and a rule that tries to be
 * both would need updating every time a route legitimately grows.
 *
 * A route that genuinely needs to import a differently-named module can add
 * itself to `SHARES_A_MODULE` with a reason. An empty escape hatch is better
 * than no escape hatch: the next person meets a named exception rather than a
 * rule they have to break silently.
 */

/** Route folder -> the module it legitimately imports instead. */
const SHARES_A_MODULE: Record<string, string> = {
  // Predates this rule and is correct: the route is named for the operation a
  // human dispatches, the module for the thing it copies. Renaming either to
  // satisfy a test would be the test deciding the vocabulary.
  'backfill-media-copies': 'backfill-supplier-media-copies',
};

/**
 * A hand-rolled walk rather than a glob: `globSync` is not in this repository's
 * `@types/node`, and the alternative was a dependency for one directory tree.
 */
function routeFiles(directory = 'src/app/api/internal'): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;

    if (entry.isDirectory()) return routeFiles(path);

    return entry.name === 'route.ts' ? [path] : [];
  });
}

describe('internal routes call their own module', () => {
  const files = routeFiles();

  it('finds the internal routes at all, so an empty glob cannot pass', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files)('%s imports the module its folder names', (file) => {
    const folder = file.split('/').at(-2) ?? '';
    const expected = SHARES_A_MODULE[folder] ?? folder;
    const source = readFileSync(file, 'utf8');
    const imported = [...source.matchAll(/import\(\s*'([^']+)'/gu)].map(
      (match) => match[1] ?? '',
    );

    // A route with no dynamic import is a route that does its own work inline,
    // which this rule has nothing to say about.
    if (imported.length === 0) return;

    expect(
      imported.some((specifier) => specifier.endsWith(`/${expected}`)),
      `${file} imports ${JSON.stringify(imported)} but its folder is "${folder}"`,
    ).toBe(true);
  });
});
