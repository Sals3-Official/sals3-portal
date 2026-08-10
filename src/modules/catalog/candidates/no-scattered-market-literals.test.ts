import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Repository guard (ADR-014): the candidate-pipeline runtime must source
 * buyer destination-country codes only from
 * `resolveBuyerDestinationCountryPolicy()`, never a scattered literal like
 * the old `INGESTION_MARKET_CODES = ['PH']` / `PLACEHOLDER_MARKET_CODE =
 * 'PH'`. This scans this module's own real runtime source (not its tests,
 * and not the approved resolver files themselves) for a bare `'PH'`/`'AU'`
 * market-code-shaped literal, so a future edit cannot silently reintroduce
 * one.
 *
 * Deliberately narrow: this directory is the real candidate-pipeline
 * runtime. It does not scan the explicitly-labelled illustrative Seller
 * Center market fixture (`src/lib/seller-center/market-config.ts`) or the
 * "All Supplier Products" design-preview fixtures, which are allowed to name
 * sample markets - see `hot.md`'s "do not convert into authority" carve-out.
 */

const SCAN_ROOT = join(__dirname); // src/modules/catalog/candidates
const MARKET_CODE_PATTERN = /(['"])(PH|AU)\1/;

const SKIPPED_FILE_SUFFIXES = ['.test.ts', '.test.tsx'];

function collectTsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);

    if (entry.isDirectory()) return collectTsFiles(full);
    if (!/\.tsx?$/.test(entry.name)) return [];
    if (SKIPPED_FILE_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) {
      return [];
    }

    return [full];
  });
}

describe('candidate-pipeline runtime has no scattered market-code literals', () => {
  it('never hardcodes a bare PH/AU market code outside the approved resolver', () => {
    const offenders = collectTsFiles(SCAN_ROOT)
      .map((file) => ({ file, content: readFileSync(file, 'utf8') }))
      .filter(({ content }) => MARKET_CODE_PATTERN.test(content))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });
});
