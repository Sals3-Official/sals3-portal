import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Repository guard for the request-scoped seller read.
 *
 * Measured before `seller-account.ts` existed: one render of
 * `/products/pipeline` read the SAME `seller_accounts` row three times - the
 * layout's `getSession()`, `requireDropshipperAccount`'s own `getSession()`, and
 * its explicit lookup. Routing them through one `React.cache`d reader brought
 * that to one, and the measured statement count for a render fell from 12 to 10.
 *
 * A unit test cannot prove the dedup itself: React's `cache` reads its memo store
 * from the cache dispatcher, which only exists inside a render scope, so outside
 * one it simply calls through and a "was deduped" assertion would assert the
 * opposite of reality. What CAN be proven, and is what actually regresses, is the
 * call graph: if a future edit reintroduces a direct repository call in the auth
 * or portal layers, the dedup silently stops applying to it. This scans for that.
 *
 * Scope is deliberately narrow. The repository function itself, scripts, the
 * evaluator, and the storefront may all call it directly - they are not inside a
 * render, where `cache` would help.
 */

const REPOSITORY_CALL = 'findSellerAccountByIdentityId(';
const ALLOWED = ['src/lib/auth/seller-account.ts'];

const SCAN_ROOTS = [
  join(__dirname), // src/lib/auth
  join(__dirname, '..', 'portal'),
];

const SKIPPED_SUFFIXES = ['.test.ts', '.test.tsx'];

function collectTsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);

    if (entry.isDirectory()) return collectTsFiles(full);
    if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) return [];
    if (SKIPPED_SUFFIXES.some((suffix) => entry.name.endsWith(suffix)))
      return [];

    return [full];
  });
}

describe('seller account reads inside a render', () => {
  it('go through the one request-scoped reader, never the repository directly', () => {
    const offenders = SCAN_ROOTS.flatMap(collectTsFiles)
      .filter((file) => readFileSync(file, 'utf8').includes(REPOSITORY_CALL))
      .map((file) => file.replaceAll('\\', '/'))
      .map((file) => file.slice(file.indexOf('src/')))
      .filter((relative) => !ALLOWED.includes(relative));

    expect(offenders).toEqual([]);
  });

  it('has exactly one reader, so there is one place to change', () => {
    const readers = SCAN_ROOTS.flatMap(collectTsFiles).filter((file) =>
      readFileSync(file, 'utf8').includes(REPOSITORY_CALL),
    );

    expect(readers).toHaveLength(1);
  });
});
