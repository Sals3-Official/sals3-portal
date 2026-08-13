import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Repository guard for the owner's lean intake policy and CJ call-budget
 * decision (ADR-013 §1a, 2026-08-12).
 *
 * Raw All Supplier Products intake and review must never call a paid
 * supplier-evidence endpoint, and must never call an AI service. Unit tests
 * with mocked adapters cannot prove that on their own - a reintroduced call
 * would just hit the mock. This scans the real runtime source instead, so the
 * rule survives a future edit by someone who has not read the ADR.
 *
 * Scanned: the candidate pipeline, the discovery runtime, and the All
 * Supplier Products UI subtree. Excluded: tests, and `cj-adapter.ts` itself,
 * which is *allowed* to contain these endpoints - a deliberate, separately
 * budgeted product-detail fetch during real draft conversion is future work
 * that will call it, and forbidding the adapter from having the method would
 * be forbidding the wrong thing.
 *
 * ## The one exempt caller (2026-08-13)
 *
 * That future work has now landed as `candidates/capture-evidence.ts`, which
 * is exactly the "deliberate, separately budgeted" fetch the paragraph above
 * anticipated - not intake, and not review. The rule it must still satisfy is
 * that browsing, screening, and discovery cannot reach it, which the third
 * test below asserts directly.
 *
 * The exemption is a named file, not a relaxed pattern: every other file in
 * the scanned tree is still forbidden from naming a paid endpoint, so adding
 * a second spender is a visible, reviewable edit to this list rather than a
 * silent one.
 */

const REPO_SRC = join(__dirname, '..', '..');

const SCANNED_DIRECTORIES = [
  join(REPO_SRC, 'modules', 'catalog', 'candidates'),
  join(REPO_SRC, 'modules', 'catalog', 'discovery'),
  join(REPO_SRC, 'components', 'products', 'supplier-products'),
];

/**
 * Paid CJ evidence endpoints, plus AI-service markers. `/product/list` is
 * deliberately NOT here: it is the one legacy discovery endpoint the approved
 * policy still permits, gated by the backlog drain and rolling new-PID waves.
 */
const FORBIDDEN_PATTERNS: { label: string; pattern: RegExp }[] = [
  { label: 'product detail fetch', pattern: /\/product\/query/ },
  {
    label: 'inventory fetch',
    pattern: /getInventoryByPid|\/product\/stock\//,
  },
  { label: 'product comments fetch', pattern: /productComments/ },
  { label: 'freight quote', pattern: /freightCalculate|\/logistic\// },
  { label: 'evidence fetch helper', pattern: /getCandidateEvidence/ },
  {
    label: 'Gemini / generative AI service',
    pattern: /gemini|generativelanguage|openai/i,
  },
];

const SKIPPED_FILE_SUFFIXES = ['.test.ts', '.test.tsx'];

/**
 * Files permitted to spend evidence budget, each because it is an explicit,
 * permission-gated, rate-limited operator action rather than intake or review.
 * See the module doc. Keep this list as short as the policy allows.
 */
const EVIDENCE_SPENDER_EXEMPTIONS = ['capture-evidence.ts'];

/**
 * Strips block and line comments before matching. Without this the guard
 * would trip on its own subject matter: the files that REMOVED these calls
 * necessarily name them in the comments explaining why. What matters is that
 * no executable line reaches them.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

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

describe('raw supplier intake and review spend no supplier evidence budget', () => {
  it('contains no paid CJ evidence endpoint and no AI service call', () => {
    const files = SCANNED_DIRECTORIES.flatMap(collectTsFiles);

    expect(files.length).toBeGreaterThan(0);

    const offenders = files
      .filter(
        (file) =>
          !EVIDENCE_SPENDER_EXEMPTIONS.some((exempt) => file.endsWith(exempt)),
      )
      .flatMap((file) => {
        const content = stripComments(readFileSync(file, 'utf8'));

        return FORBIDDEN_PATTERNS.filter(({ pattern }) =>
          pattern.test(content),
        ).map(({ label }) => `${file}: ${label}`);
      });

    expect(offenders).toEqual([]);
  });

  /**
   * The exemption above is only sound while nothing on a browse, screening, or
   * discovery path can reach the spender. A page render that transitively
   * imported it would put three CJ requests behind a navigation - which is the
   * precise failure ADR-013 §1a exists to prevent - so this asserts the
   * import graph rather than trusting the review that added the exemption.
   */
  it('keeps the exempt evidence spender out of browse, screening, and discovery', () => {
    const spender = 'capture-evidence';
    const importers = [
      ...collectTsFiles(
        join(REPO_SRC, 'components', 'products', 'supplier-products'),
      ),
      ...collectTsFiles(join(REPO_SRC, 'modules', 'catalog', 'discovery')),
      ...collectTsFiles(join(REPO_SRC, 'modules', 'catalog', 'candidates')),
    ].filter((file) => !file.endsWith('capture-evidence.ts'));

    const offenders = importers.filter((file) =>
      new RegExp(`from\\s+['"][^'"]*${spender}['"]`).test(
        stripComments(readFileSync(file, 'utf8')),
      ),
    );

    expect(offenders).toEqual([]);
  });

  /**
   * Owner decision 2026-08-13: the All Supplier Products page is a live
   * `/product/list` browse, so its Server Component workspace legitimately
   * constructs the CJ adapter. That construction is confined to exactly one
   * file - every other file in the subtree (table, drawer, filters,
   * pagination) must stay supplier-client-free so a future edit cannot
   * quietly spread live supplier calls through presentation components.
   */
  it('confines the supplier client to the workspace entry point', () => {
    const files = collectTsFiles(
      join(REPO_SRC, 'components', 'products', 'supplier-products'),
    );

    const offenders = files.filter(
      (file) =>
        !file.endsWith('SupplierProductsWorkspace.tsx') &&
        /cj-adapter|cj-auth|supplier-secret-store|modules\/suppliers\/providers/.test(
          stripComments(readFileSync(file, 'utf8')),
        ),
    );

    expect(offenders).toEqual([]);
  });
});
