import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * No client module may reach the taxonomy extract.
 *
 * `category-trail.ts` imports `sals3-taxonomy-v1.json` — 5,595 rows — and one
 * import from a `'use client'` component would ship all of it to every browser.
 * `variation-families.ts` guards its own extract with `import 'server-only'`,
 * which is the right default and does not fit here: this module is reached
 * through `catalog-feed.ts`, which six `/api/storefront/*` routes import, so the
 * guard put **seven** test files into `vi.mock('server-only')` to test pure
 * functions. `read-model.ts` refused it for the same reason at nine files.
 *
 * So the property is asserted instead of proxied. This walks the import graph
 * from every `'use client'` module in `src/` and fails if any path reaches the
 * extract — which is what the guard was for, without making seven suites mock a
 * module to say nothing about themselves.
 *
 * Same shape as `no-supplier-calls.test.ts`, which walks the buyer request path
 * to prove it reaches no supplier adapter.
 */

const SOURCE_ROOT = resolve(process.cwd(), 'src');
const EXTENSIONS = ['.ts', '.tsx'];

/** Relative and alias specifiers only; a package import cannot reach `src/`. */
const IMPORT_PATTERN = /(?:from|import)\s+['"]([.@][^'"]+)['"]/g;

const FORBIDDEN = [
  'modules/catalog/taxonomy/category-trail',
  'lib/db/seed-data/sals3-taxonomy-v1.json',
];

function everySourceFile(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry);

    if (statSync(full).isDirectory()) return everySourceFile(full);
    if (!EXTENSIONS.some((extension) => full.endsWith(extension))) return [];
    // A test file is never bundled for a browser.
    if (/\.test\.tsx?$/.test(full)) return [];

    return [full];
  });
}

/** `@/x` and `./x` to an absolute file, or `null` for anything unresolvable. */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
  const base = specifier.startsWith('@/')
    ? join(SOURCE_ROOT, specifier.slice(2))
    : resolve(dirname(fromFile), specifier);

  const candidates = [
    base,
    ...EXTENSIONS.map((extension) => `${base}${extension}`),
    ...EXTENSIONS.map((extension) => join(base, `index${extension}`)),
  ];

  return (
    candidates.find(
      (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
    ) ?? null
  );
}

function importsOf(file: string): string[] {
  const source = readFileSync(file, 'utf8');

  return [...source.matchAll(IMPORT_PATTERN)].flatMap((match) => {
    const specifier = match[1];

    if (specifier === undefined) return [];

    const resolved = resolveSpecifier(file, specifier);

    return resolved === null ? [] : [resolved];
  });
}

/** Every file reachable from `entry`, including itself. */
function reachableFrom(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop();

    if (file !== undefined && !seen.has(file)) {
      seen.add(file);
      queue.push(...importsOf(file));
    }
  }

  return seen;
}

function isClientModule(file: string): boolean {
  // The directive has to be the first statement, so the top of the file is where
  // it is; reading further would match it inside a comment or a string.
  return /^\s*(?:\/\*[\s\S]*?\*\/\s*)?['"]use client['"]/.test(
    readFileSync(file, 'utf8'),
  );
}

describe('the taxonomy extract stays out of every browser bundle', () => {
  const clientModules = everySourceFile(SOURCE_ROOT).filter(isClientModule);

  it('finds client modules to check, so a passing run means something', () => {
    // Without this, a broken walker or a moved `src/` would make the assertion
    // below vacuously true — the failure mode `no-supplier-calls.test.ts`
    // guards the same way.
    expect(clientModules.length).toBeGreaterThan(20);
  });

  it('reaches neither the trail module nor the extract from any of them', () => {
    const offenders = clientModules.flatMap((entry) => {
      const reached = [...reachableFrom(entry)].map((file) =>
        file.replaceAll('\\', '/'),
      );
      const hit = FORBIDDEN.find((forbidden) =>
        reached.some((file) => file.includes(forbidden)),
      );

      return hit === undefined
        ? []
        : [`${entry.replaceAll('\\', '/')} reaches ${hit}`];
    });

    expect(offenders).toEqual([]);
  });

  it('would notice a client module that did reach it', () => {
    // The walker proved against a module that genuinely imports the trail:
    // `catalog-feed.ts` is server-side, so it must be found from there and not
    // from any client entry.
    const feed = join(SOURCE_ROOT, 'lib', 'storefront', 'catalog-feed.ts');
    const reached = [...reachableFrom(feed)].map((file) =>
      file.replaceAll('\\', '/'),
    );

    expect(reached.some((file) => file.includes(FORBIDDEN[0] as string))).toBe(
      true,
    );
  });
});
