/* eslint-disable no-console -- this is a CLI script; status output is its job. */
/**
 * Extracts the `Universal_Category_Taxonomy` sheet's *family* columns into
 * deterministic, checksum-stamped JSON reference data.
 *
 * ## Why this exists separately from the presets extract
 *
 * `sals3-taxonomy-presets-v1.json` already carries this sheet's
 * `Tier 1/2 Attribute` columns, but those hold long human guidance strings —
 * `Color / Finish / Material (Stainless/Ceramic/Cast Iron/Black)`. They are
 * useful as guidance and useless as a buyer-facing option name; putting one in
 * a storefront dropdown label is the "pangit" outcome this extract exists to
 * avoid.
 *
 * The owner's re-authored workbook added `Tier 1/2 Attribute Families`, which
 * are short controlled tokens (`COLOR`, `SIZE`, `MODEL_SPEC`). Those map cleanly
 * to a buyer-facing axis name. This script is the one place the `.xlsx` is read
 * for them; `modules/catalog/taxonomy` parses no workbook at runtime.
 *
 * ## What this refuses to guess
 *
 * Every family token is checked against `FAMILY_VOCABULARY` below. An
 * unrecognized token aborts the extraction, naming the offending row, rather
 * than being silently carried into reference data that then prefills a
 * buyer-facing label — same discipline as
 * `extract-category-attribute-controls.mts`'s enum allow-lists.
 *
 * The tokens are recorded verbatim. This script does **not** decide what a
 * family is called in the UI; `modules/catalog/taxonomy/variation-families.ts`
 * owns that mapping, so a copy change never requires re-extracting a workbook.
 *
 * ## Offline by design
 *
 * Unlike the attribute-controls extract, this needs no database: every category
 * code is cross-checked against the committed `sals3-taxonomy-v1.json`, which is
 * the same frozen extract the seeder writes `sals3_categories` from. So this runs
 * with no `DATABASE_URL` and cannot be affected by whatever a local database
 * happens to hold.
 *
 * ## Usage
 *
 *   npm run extract:variation-families -- --discover-families
 *   npm run extract:variation-families -- --dry-run
 *   npm run extract:variation-families
 *
 * `--discover-families` prints the exact distinct token set found in both family
 * columns and exits without writing — the manual gate before `FAMILY_VOCABULARY`
 * may be trusted for a newly-supplied workbook.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
/* eslint-disable import/extensions -- extensionless is what actually works
   here, matching this codebase's own scripts/ convention. */
import { ACTIVE_TAXONOMY_VERSION } from '../src/lib/db/schema/category-mapping';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));

/**
 * The workbook lives in the sibling vault repository, not in this one. Same
 * relative hop `extract-category-attribute-controls.mts` uses.
 */
const WORKBOOK_PATH = join(
  scriptDirectory,
  '..',
  '..',
  'sals3-ecommerce',
  'docs',
  'Raw',
  'universal_category_variation_taxonomy_final_clean.xlsx',
);

const OUTPUT_PATH = join(
  scriptDirectory,
  '..',
  'src',
  'lib',
  'db',
  'seed-data',
  'sals3-category-variation-families-v1.json',
);

const TAXONOMY_PATH = join(
  scriptDirectory,
  '..',
  'src',
  'lib',
  'db',
  'seed-data',
  'sals3-taxonomy-v1.json',
);

const SHEET_NAME = 'Universal_Category_Taxonomy';

const COLUMN = {
  code: 'Universal Category Code',
  patternCode: 'Variation Pattern Code',
  tier1Families: 'Tier 1 Attribute Families',
  tier2Families: 'Tier 2 Attribute Families',
} as const;

/**
 * Every family token this workbook is allowed to contain, verified against the
 * supplied file by `--discover-families`. Extraction aborts on anything else:
 * an unknown token would reach `variation-families.ts`, find no axis name, and
 * silently degrade a category to "no suggestion" — a quiet coverage hole is
 * exactly the failure this whole task is fixing.
 */
const FAMILY_VOCABULARY = [
  'BUNDLE',
  'CAPACITY',
  'COLOR',
  'FITMENT',
  'FOOD_BEAUTY',
  'MATERIAL',
  'MODEL_SPEC',
  'SIZE',
] as const;

/** The workbook separates multiple families in one cell with `;`. */
const FAMILY_DELIMITER = ';';

const EXPECTED_DATA_ROWS = 5595;
const EXPECTED_PATTERNS = 86;

type PatternRow = {
  patternCode: string;
  tier1Families: string[];
  tier2Families: string[];
};

type CategoryAssignment = { code: string; patternCode: string };

function parseFamilies(cell: string): string[] {
  return cell
    .split(FAMILY_DELIMITER)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

/**
 * Returns the path to a repaired, temporary copy of the workbook.
 *
 * This workbook's XML parts declare every OOXML element under an `x:` prefix
 * (`<x:workbook>`, `<x:sheet>`, ...) instead of the unprefixed default namespace
 * a normal Excel/LibreOffice export uses. `exceljs`'s parser only recognizes
 * unprefixed element names, and on this file throws outright:
 * `TypeError: Cannot read properties of undefined (reading 'sheets')`. Rather
 * than add a second, differently-vulnerable XLSX library, this loads the archive
 * with `jszip`, strips the prefix from every XML part in memory, and rezips.
 *
 * Deliberately a local copy of the same helper in
 * `extract-category-attribute-controls.mts` rather than a shared import: that
 * file is UTF-16 encoded and rewriting it to share this risks corrupting a
 * working, already-merged extractor, and `scripts/` has no resolvable module path
 * for a `.mts` sibling under this project's lint/TypeScript settings. Fold the
 * two together the next time either is edited for a real reason.
 *
 * The file on disk is never modified; the caller removes the temp directory.
 */
async function repairWorkbookToTempFile(path: string): Promise<{
  filePath: string;
  cleanup: () => Promise<void>;
}> {
  const bytes = readFileSync(path);
  const zip = await JSZip.loadAsync(bytes);
  const xmlEntries = Object.keys(zip.files).filter(
    (name) => name.endsWith('.xml') && zip.files[name]?.dir !== true,
  );

  await Promise.all(
    xmlEntries.map(async (name) => {
      const entry = zip.files[name];

      if (entry === undefined) return;

      const content = await entry.async('string');
      const stripped = content
        .replace(/<x:/g, '<')
        .replace(/<\/x:/g, '</')
        .replace(
          /\sxmlns:x="[^"]*"/g,
          ' xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
        );

      zip.file(name, stripped);
    }),
  );

  const generated = await zip.generateAsync({ type: 'nodebuffer' });
  const tempDir = await mkdtemp(join(tmpdir(), 'sals3-variation-families-'));
  const filePath = join(tempDir, 'repaired.xlsx');

  await writeFile(filePath, generated);

  return {
    filePath,
    cleanup: () => rm(tempDir, { recursive: true, force: true }),
  };
}

function cellText(row: ExcelJS.Row, index: number): string {
  const { value } = row.getCell(index);

  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && 'richText' in value) {
    return value.richText
      .map((part) => part.text)
      .join('')
      .trim();
  }

  return String(value).trim();
}

async function main(): Promise<void> {
  const discoverOnly = process.argv.includes('--discover-families');
  const dryRun = process.argv.includes('--dry-run');

  const workbook = new ExcelJS.Workbook();
  // This workbook's XML parts are `x:`-prefixed, which `exceljs` cannot parse.
  const repaired = await repairWorkbookToTempFile(WORKBOOK_PATH);

  try {
    await workbook.xlsx.readFile(repaired.filePath);
  } finally {
    await repaired.cleanup();
  }

  const sheet = workbook.getWorksheet(SHEET_NAME);

  if (sheet === undefined) {
    throw new Error(
      `Sheet "${SHEET_NAME}" not found. Sheets present: ${workbook.worksheets.map((s) => s.name).join(', ')}`,
    );
  }

  const header = sheet.getRow(1);
  const columnIndex = new Map<string, number>();

  header.eachCell((cell, index) => {
    const name = String(cell.value ?? '').trim();

    if (name !== '') columnIndex.set(name, index);
  });

  const missingColumns = Object.values(COLUMN).filter(
    (name) => !columnIndex.has(name),
  );

  if (missingColumns.length > 0) {
    throw new Error(
      `Column(s) ${missingColumns.map((name) => `"${name}"`).join(', ')} missing from ${SHEET_NAME}. This workbook is not the expected one.`,
    );
  }

  const codeAt = columnIndex.get(COLUMN.code) ?? 0;
  const patternAt = columnIndex.get(COLUMN.patternCode) ?? 0;
  const tier1At = columnIndex.get(COLUMN.tier1Families) ?? 0;
  const tier2At = columnIndex.get(COLUMN.tier2Families) ?? 0;

  type SheetRow = {
    rowNumber: number;
    code: string;
    patternCode: string;
    tier1Families: string[];
    tier2Families: string[];
  };

  const sheetRows: SheetRow[] = [];

  // `eachRow` rather than an index loop: exceljs already knows which rows exist,
  // and a blank code is skipped by returning from the callback.
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const code = cellText(row, codeAt);

    if (code === '') return;

    const patternCode = cellText(row, patternAt);

    if (patternCode === '') {
      throw new Error(
        `Row ${rowNumber} (${code}) has no ${COLUMN.patternCode}.`,
      );
    }

    sheetRows.push({
      rowNumber,
      code,
      patternCode,
      tier1Families: parseFamilies(cellText(row, tier1At)),
      tier2Families: parseFamilies(cellText(row, tier2At)),
    });
  });

  const isKnownFamily = (token: string): boolean =>
    FAMILY_VOCABULARY.includes(token as (typeof FAMILY_VOCABULARY)[number]);
  const tokensWithRow = sheetRows.flatMap((row) =>
    [...row.tier1Families, ...row.tier2Families].map((token) => ({
      token,
      where: `row ${row.rowNumber} (${row.code})`,
    })),
  );
  const discovered = new Set(tokensWithRow.map((entry) => entry.token));
  const unknown = tokensWithRow
    .filter((entry) => !isKnownFamily(entry.token))
    .map((entry) => `${entry.where}: ${entry.token}`);

  const assignments: CategoryAssignment[] = sheetRows.map((row) => ({
    code: row.code,
    patternCode: row.patternCode,
  }));

  const signatureOf = (
    tier1Families: string[],
    tier2Families: string[],
  ): string =>
    `${tier1Families.join(FAMILY_DELIMITER)}|${tier2Families.join(FAMILY_DELIMITER)}`;
  const patternByCode = new Map<string, PatternRow>();

  sheetRows.forEach((row) => {
    const existing = patternByCode.get(row.patternCode);

    if (existing === undefined) {
      patternByCode.set(row.patternCode, {
        patternCode: row.patternCode,
        tier1Families: row.tier1Families,
        tier2Families: row.tier2Families,
      });

      return;
    }

    const existingSignature = signatureOf(
      existing.tier1Families,
      existing.tier2Families,
    );
    const signature = signatureOf(row.tier1Families, row.tier2Families);

    // A pattern code that disagreed with itself would make the pattern table
    // meaningless and the per-category assignment below unresolvable.
    if (existingSignature !== signature) {
      throw new Error(
        `Pattern ${row.patternCode} carries two different family sets: "${existingSignature}" and "${signature}" (row ${row.rowNumber}, ${row.code}).`,
      );
    }
  });

  if (discoverOnly) {
    console.log(`Distinct family tokens in ${SHEET_NAME}:`);
    [...discovered]
      .sort()
      .forEach((token) =>
        console.log(`  ${isKnownFamily(token) ? ' ' : '!'} ${token}`),
      );
    console.log(
      `
${discovered.size} distinct token(s). "!" marks tokens absent from FAMILY_VOCABULARY.`,
    );

    return;
  }

  if (unknown.length > 0) {
    throw new Error(
      `Unrecognized family token(s) — extraction refused so no unmapped token reaches reference data:\n  ${unknown.slice(0, 20).join('\n  ')}${unknown.length > 20 ? `\n  ...and ${unknown.length - 20} more` : ''}\n\nRun with --discover-families, then extend FAMILY_VOCABULARY deliberately.`,
    );
  }

  if (assignments.length !== EXPECTED_DATA_ROWS) {
    throw new Error(
      `Expected ${EXPECTED_DATA_ROWS} data rows, found ${assignments.length}. This workbook is not the expected one.`,
    );
  }

  if (patternByCode.size !== EXPECTED_PATTERNS) {
    throw new Error(
      `Expected ${EXPECTED_PATTERNS} distinct pattern codes, found ${patternByCode.size}.`,
    );
  }

  const duplicateCodes =
    assignments.length - new Set(assignments.map((a) => a.code)).size;

  if (duplicateCodes > 0) {
    throw new Error(
      `${duplicateCodes} duplicate category code(s) in the sheet.`,
    );
  }

  // Cross-check against the frozen taxonomy extract rather than a database, so
  // this script's output can never depend on what one environment happens to
  // hold. A code here that the taxonomy does not have would fail the seeder's
  // own fail-closed check later, at a much less obvious moment.
  const taxonomy = JSON.parse(readFileSync(TAXONOMY_PATH, 'utf8')) as {
    code: string;
  }[];
  const taxonomyCodes = new Set(taxonomy.map((row) => row.code));
  const missing = assignments.filter((a) => !taxonomyCodes.has(a.code));

  if (missing.length > 0) {
    throw new Error(
      `${missing.length} category code(s) in the workbook are absent from sals3-taxonomy-v1.json, e.g. ${missing
        .slice(0, 5)
        .map((a) => a.code)
        .join(', ')}.`,
    );
  }

  const patterns = [...patternByCode.values()].sort((left, right) =>
    left.patternCode.localeCompare(right.patternCode),
  );
  const categories = [...assignments].sort((left, right) =>
    left.code.localeCompare(right.code),
  );

  const payload = {
    familyVocabulary: [...FAMILY_VOCABULARY],
    patterns,
    categories,
  };
  const checksum = createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex');
  const workbookSha256 = createHash('sha256')
    .update(readFileSync(WORKBOOK_PATH))
    .digest('hex');

  const output = {
    source: {
      workbook: 'universal_category_variation_taxonomy_final_clean.xlsx',
      sheet: SHEET_NAME,
      vaultPath:
        'sals3-ecommerce/docs/Raw/universal_category_variation_taxonomy_final_clean.xlsx',
      dataRecords: categories.length,
      distinctPatterns: patterns.length,
      checksum,
      workbookSha256,
      taxonomyVersion: ACTIVE_TAXONOMY_VERSION,
    },
    ...payload,
  };

  console.log(
    `${categories.length} categories, ${patterns.length} patterns, ${FAMILY_VOCABULARY.length} family tokens.`,
  );
  console.log(`workbook sha256: ${workbookSha256}`);
  console.log(`payload checksum: ${checksum}`);

  const withoutTier1 = categories.filter((a) => {
    const pattern = patternByCode.get(a.patternCode);

    return pattern === undefined || pattern.tier1Families.length === 0;
  }).length;
  const withoutTier2 = categories.filter((a) => {
    const pattern = patternByCode.get(a.patternCode);

    return pattern === undefined || pattern.tier2Families.length === 0;
  }).length;

  console.log(
    `coverage: ${categories.length - withoutTier1} categories have a tier-1 family, ${categories.length - withoutTier2} have a tier-2 family.`,
  );

  if (dryRun) {
    console.log('\n--dry-run: nothing written.');

    return;
  }

  await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(`\nWrote ${OUTPUT_PATH}`);
}

await main();
