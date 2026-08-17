/* eslint-disable no-console -- this is a CLI script; status output is its job. */
/**
 * Extracts `Category_Attribute_Controls` and `Attribute_Control_Dictionary`
 * from the finalized taxonomy workbook into deterministic, checksum-stamped
 * JSON reference data.
 *
 * ## Why extract-once rather than parse-at-runtime
 *
 * The taxonomy module parses no workbook at runtime (`boundaries.test.ts`
 * already asserts this of the rest of `modules/catalog/taxonomy`). This
 * script is the one place `.xlsx` is ever read, and it runs offline, by a
 * person, producing a committed JSON file the app actually loads from.
 *
 * ## What this script refuses to guess
 *
 * Every workbook column that becomes a Postgres enum is read through an
 * explicit allow-list map (`INPUT_CONTROL_TYPE_MAP`, etc.) below. An
 * unrecognized workbook string throws immediately, naming the offending row,
 * rather than being coerced into the nearest-looking enum member — same
 * discipline as `readVariationTiers`'s allow-listed prefix match in
 * `modules/catalog/taxonomy/category-form.ts`.
 *
 * ## Regression guards
 *
 * Every invariant already verified true of this workbook by hand (exact
 * sheet names, exact row counts, zero duplicate (category, attribute) pairs,
 * the dropdown/allowed-values invariant, dictionary <-> controls 1:1, and
 * cross-sheet L1-L5 agreement against the *live* `sals3_categories` table)
 * is re-asserted here and aborts extraction loudly if it ever stops being
 * true — this is a guard against a *different* workbook being pointed at
 * this script, not an expectation that today's file will fail it.
 *
 * ## Usage
 *
 *   npm run extract:attribute-controls -- --discover-enums
 *   npm run extract:attribute-controls -- --dry-run
 *   npm run extract:attribute-controls
 *
 * `--discover-enums` reads the workbook and prints the exact distinct value
 * set for every column destined to become a Postgres enum, then exits
 * without writing anything - the required manual gate before this script's
 * own allow-list maps may be trusted.
 *
 * `--dry-run` runs every validation and reports counts but does not write
 * the output JSON file.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
/* eslint-disable import/extensions -- extensionless is what actually works
   here, matching this codebase's own scripts/ convention. */
import { sals3Categories } from '../src/lib/db/schema/pricing-policy';

try {
  process.loadEnvFile('.env.local');
} catch {
  // No .env.local - env vars must already be exported in the shell.
}

const WORKBOOK_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'sals3-ecommerce',
  'docs',
  'Raw',
  'universal_category_variation_taxonomy_final_clean.xlsx',
);

const CONTROLS_VERSION = 'sals3-attribute-controls-v1';

const EXPECTED_SHEET_NAMES = [
  'Universal_Category_Taxonomy',
  'Category_Attribute_Controls',
  'Attribute_Control_Dictionary',
  'Cleanup Notes',
];

const EXPECTED_CATEGORY_COUNT = 5_595;
const EXPECTED_CONTROL_ROW_COUNT = 53_625;
const EXPECTED_DICTIONARY_ROW_COUNT = 149;

/** Allow-list. An unrecognized workbook string throws — never guessed. */
const INPUT_CONTROL_TYPE_MAP: Record<string, string> = {
  'Single-select dropdown': 'SINGLE_SELECT_DROPDOWN',
  'Multi-select dropdown': 'MULTI_SELECT_DROPDOWN',
  'Text input': 'TEXT_INPUT',
  'Number input': 'NUMBER_INPUT',
  'Measurement input': 'MEASUREMENT_INPUT',
  'Boolean toggle': 'BOOLEAN_TOGGLE',
  'Date picker': 'DATE_PICKER',
};

const REQUIREMENT_LEVEL_MAP: Record<string, string> = {
  REQUIRED: 'REQUIRED',
  RECOMMENDED: 'RECOMMENDED',
  OPTIONAL: 'OPTIONAL',
};

const SEO_VISIBILITY_MAP: Record<string, string> = {
  PDP_VISIBLE: 'PDP_VISIBLE',
  STRUCTURED_DATA_ELIGIBLE: 'STRUCTURED_DATA_ELIGIBLE',
  ATTRIBUTE_CONTEXT_ONLY: 'ATTRIBUTE_CONTEXT_ONLY',
};

const AEO_GEO_VISIBILITY_MAP: Record<string, string> = {
  ANSWER_SUMMARY_USEFUL: 'ANSWER_SUMMARY_USEFUL',
  ATTRIBUTE_CONTEXT_ONLY: 'ATTRIBUTE_CONTEXT_ONLY',
};

const COMPLIANCE_REVIEW_FLAG_MAP: Record<string, string> = {
  STANDARD_CATALOG_REVIEW: 'STANDARD_CATALOG_REVIEW',
  WARRANTY_TERMS_COMPLIANCE: 'WARRANTY_TERMS_COMPLIANCE',
  FOOD_SAFETY_REGISTRATION: 'FOOD_SAFETY_REGISTRATION',
  REGULATED_HEALTH_SAFETY_CLAIM: 'REGULATED_HEALTH_SAFETY_CLAIM',
  EXPIRATION_AND_SHELF_LIFE: 'EXPIRATION_AND_SHELF_LIFE',
  COSMETIC_REGULATORY_NOTIFICATION: 'COSMETIC_REGULATORY_NOTIFICATION',
  VEHICLE_FITMENT_CRITICAL: 'VEHICLE_FITMENT_CRITICAL',
  CHILD_SAFETY_CERTIFICATION: 'CHILD_SAFETY_CERTIFICATION',
  LEGAL_IDENTIFIER_VERIFICATION: 'LEGAL_IDENTIFIER_VERIFICATION',
  DIGITAL_LICENSE_VALIDATION: 'DIGITAL_LICENSE_VALIDATION',
  DIGITAL_DELIVERY_REVIEW: 'DIGITAL_DELIVERY_REVIEW',
};

const DATA_TYPE_MAP: Record<string, string> = {
  string: 'STRING',
  'string[]': 'STRING_ARRAY',
};

const DROPDOWN_TYPES = new Set([
  'SINGLE_SELECT_DROPDOWN',
  'MULTI_SELECT_DROPDOWN',
]);

const moduleDir = dirname(fileURLToPath(import.meta.url));
const seedDir = join(moduleDir, '..', 'src', 'lib', 'db', 'seed-data');

type SheetRow = Record<string, string | number | boolean | null>;

/**
 * Returns the path to a repaired, temporary copy of the workbook.
 *
 * This workbook's XML parts declare every OOXML element under an `x:` prefix
 * (`<x:workbook>`, `<x:sheet>`, ...) instead of the unprefixed default
 * namespace a normal Excel/LibreOffice export uses. `exceljs`'s parser only
 * recognizes unprefixed element names and otherwise returns an incomplete
 * model (confirmed by reading `xl/workbook.xml` directly with Python's
 * `zipfile` — every part uses the same `x:` prefix). Rather than add a
 * second, differently-vulnerable XLSX library, this loads the archive with
 * `jszip` (already a transitive dependency of `exceljs`, now direct), strips
 * the prefix from every XML part in memory, and rezips.
 *
 * The rezipped archive is written to a temp file and read back by path
 * rather than handed to `exceljs` as an in-memory buffer, because `exceljs`'s
 * own bundled type declarations (`declare interface Buffer extends
 * ArrayBuffer {}`) are incompatible with this project's `esnext` lib target
 * for a direct buffer argument - `readFile(path: string)` is the same entry
 * point `exceljs` expects everywhere else, and sidesteps the type conflict
 * entirely. The file on disk at `path` is never modified; the caller is
 * responsible for removing the returned temp directory.
 */
async function repairWorkbookToTempFile(path: string): Promise<{
  filePath: string;
  cleanup: () => Promise<void>;
}> {
  const bytes = readFileSync(path);
  const zip = await JSZip.loadAsync(bytes);
  const xmlEntries = Object.keys(zip.files).filter(
    (name) => name.endsWith('.xml') && !zip.files[name].dir,
  );

  await Promise.all(
    xmlEntries.map(async (name) => {
      const content = await zip.files[name].async('string');
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
  const tempDir = await mkdtemp(join(tmpdir(), 'sals3-attribute-controls-'));
  const filePath = join(tempDir, 'repaired.xlsx');

  await writeFile(filePath, generated);

  return {
    filePath,
    cleanup: () => rm(tempDir, { recursive: true, force: true }),
  };
}

function cellValueToPrimitive(raw: unknown): string | number | boolean | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'object' && 'text' in raw) {
    return String((raw as { text: unknown }).text);
  }

  return raw as string | number | boolean;
}

function boolFrom(value: string | number | boolean | null): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.trim().toUpperCase() === 'TRUE';

  throw new Error(`Expected a boolean-shaped cell, got: ${String(value)}`);
}

function strFrom(value: string | number | boolean | null): string {
  if (value === null || value === undefined) return '';

  return String(value).trim();
}

async function readSheet(
  workbook: ExcelJS.Workbook,
  sheetName: string,
): Promise<SheetRow[]> {
  const sheet = workbook.getWorksheet(sheetName);

  if (sheet === undefined) {
    throw new Error(`Expected sheet "${sheetName}" not found in workbook.`);
  }

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];

  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers[colNumber] = String(cell.value ?? '').trim();
  });

  const rows: SheetRow[] = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const record: SheetRow = {};

    headers.forEach((header, colNumber) => {
      if (header === '') return;
      const cell = row.getCell(colNumber);
      const raw = cell.value;

      record[header] = cellValueToPrimitive(raw);
    });

    rows.push(record);
  });

  return rows;
}

function distinctValueCounts(
  rows: SheetRow[],
  column: string,
): Map<string, number> {
  const counts = new Map<string, number>();

  rows.forEach((row) => {
    const value = strFrom(row[column]);

    counts.set(value, (counts.get(value) ?? 0) + 1);
  });

  return counts;
}

async function main(): Promise<void> {
  const discoverEnums = process.argv.includes('--discover-enums');
  const dryRun = process.argv.includes('--dry-run');

  const repaired = await repairWorkbookToTempFile(WORKBOOK_PATH);
  const workbook = new ExcelJS.Workbook();

  try {
    await workbook.xlsx.readFile(repaired.filePath);
  } finally {
    await repaired.cleanup();
  }

  const actualSheetNames = workbook.worksheets.map((sheet) => sheet.name);
  const missingSheets = EXPECTED_SHEET_NAMES.filter(
    (name) => !actualSheetNames.includes(name),
  );

  if (missingSheets.length > 0) {
    throw new Error(
      `Workbook is missing expected sheet(s): ${missingSheets.join(', ')}. Found: ${actualSheetNames.join(', ')}`,
    );
  }

  const taxonomyRows = await readSheet(workbook, 'Universal_Category_Taxonomy');
  const controlRows = await readSheet(workbook, 'Category_Attribute_Controls');
  const dictionaryRows = await readSheet(
    workbook,
    'Attribute_Control_Dictionary',
  );

  if (discoverEnums) {
    const columns: Array<[string, SheetRow[], string]> = [
      [
        'Category_Attribute_Controls.Requirement Level',
        controlRows,
        'Requirement Level',
      ],
      [
        'Category_Attribute_Controls.Input Control Type',
        controlRows,
        'Input Control Type',
      ],
      [
        'Category_Attribute_Controls.SEO Visibility',
        controlRows,
        'SEO Visibility',
      ],
      [
        'Category_Attribute_Controls.AEO/GEO Visibility',
        controlRows,
        'AEO/GEO Visibility',
      ],
      [
        'Category_Attribute_Controls.Compliance Review Flag',
        controlRows,
        'Compliance Review Flag',
      ],
      ['Attribute_Control_Dictionary.Data Type', dictionaryRows, 'Data Type'],
    ];

    columns.forEach(([label, rows, column]) => {
      const counts = distinctValueCounts(rows, column);

      console.log(`\n${label} (${counts.size} distinct):`);
      [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .forEach(([value, count]) =>
          console.log(`  ${count.toString().padStart(6)}  ${value}`),
        );
    });

    return;
  }

  // --- Sheet-count guards ---------------------------------------------------
  if (taxonomyRows.length !== EXPECTED_CATEGORY_COUNT) {
    throw new Error(
      `Universal_Category_Taxonomy has ${taxonomyRows.length} rows, expected ${EXPECTED_CATEGORY_COUNT}.`,
    );
  }

  if (controlRows.length !== EXPECTED_CONTROL_ROW_COUNT) {
    throw new Error(
      `Category_Attribute_Controls has ${controlRows.length} rows, expected ${EXPECTED_CONTROL_ROW_COUNT}.`,
    );
  }

  if (dictionaryRows.length !== EXPECTED_DICTIONARY_ROW_COUNT) {
    throw new Error(
      `Attribute_Control_Dictionary has ${dictionaryRows.length} rows, expected ${EXPECTED_DICTIONARY_ROW_COUNT}.`,
    );
  }

  // --- Zero duplicate (category, attribute) pairs ---------------------------
  const pairKey = (row: SheetRow) =>
    `${strFrom(row['Universal Category Code'])} ${strFrom(row['Attribute Name'])}`;
  const seenPairs = new Set<string>();

  controlRows.forEach((row) => {
    const key = pairKey(row);

    if (seenPairs.has(key)) {
      throw new Error(`Duplicate (category, attribute) pair found: ${key}`);
    }

    seenPairs.add(key);
  });

  // --- Cross-sheet L1-L5 agreement -------------------------------------------
  const taxonomyByCode = new Map(
    taxonomyRows.map((row) => [strFrom(row['Universal Category Code']), row]),
  );

  if (taxonomyByCode.size !== taxonomyRows.length) {
    throw new Error(
      'Universal_Category_Taxonomy has duplicate category codes.',
    );
  }

  const controlCodes = new Set(
    controlRows.map((row) => strFrom(row['Universal Category Code'])),
  );

  controlCodes.forEach((code) => {
    if (!taxonomyByCode.has(code)) {
      throw new Error(
        `Category_Attribute_Controls references unknown category code: ${code}`,
      );
    }
  });

  const levelColumns = [
    'L1 Department (Main)',
    'L2 Sub-Department',
    'L3 Product Class',
    'L4 Sub-Class',
    'L5 Item Specification',
  ] as const;
  const controlLevelColumns = [
    'L1 Department',
    'L2 Sub-Department',
    'L3 Product Class',
    'L4 Sub-Class',
    'L5 Item Specification',
  ] as const;

  controlRows.forEach((row) => {
    const code = strFrom(row['Universal Category Code']);
    const taxonomyRow = taxonomyByCode.get(code);

    if (taxonomyRow === undefined) return; // already thrown above

    levelColumns.forEach((taxonomyColumn, index) => {
      const controlColumn = controlLevelColumns[index];
      const taxonomyValue = strFrom(taxonomyRow[taxonomyColumn]);
      const controlValue = strFrom(row[controlColumn]);

      if (taxonomyValue !== controlValue) {
        throw new Error(
          `Level mismatch for ${code} at ${controlColumn}: taxonomy="${taxonomyValue}" controls="${controlValue}"`,
        );
      }
    });
  });

  // --- Live-DB check: this workbook's category codes are still exactly the
  // already-seeded `sals3_categories` set, not just internally self-consistent.
  const connectionString = process.env.DATABASE_URL;

  if (connectionString === undefined || connectionString === '') {
    throw new Error(
      'DATABASE_URL is not set - cannot verify the workbook against the live sals3_categories table.',
    );
  }

  const sql = postgres(connectionString, { max: 1 });
  const db = drizzle(sql);

  try {
    const liveCategories = await db
      .select({ code: sals3Categories.code })
      .from(sals3Categories);
    const liveCodes = new Set(liveCategories.map((row) => row.code));
    const workbookCodes = new Set(taxonomyByCode.keys());

    const missingFromLive = [...workbookCodes].filter(
      (code) => !liveCodes.has(code),
    );
    const extraInLive = [...liveCodes].filter(
      (code) => code.startsWith('CAT-GGL-') && !workbookCodes.has(code),
    );

    if (missingFromLive.length > 0 || extraInLive.length > 0) {
      throw new Error(
        `Workbook category codes have drifted from the live sals3_categories table. ` +
          `In workbook but not DB: ${missingFromLive.length}. In DB (CAT-GGL-*) but not workbook: ${extraInLive.length}.`,
      );
    }

    console.log(
      `Live-DB check: ${workbookCodes.size} workbook category codes match sals3_categories exactly.`,
    );
  } finally {
    await sql.end();
  }

  // --- Dictionary <-> controls 1:1 attribute-name match ----------------------
  const controlAttributeNames = new Set(
    controlRows.map((row) => strFrom(row['Attribute Name'])),
  );
  const dictionaryAttributeNames = new Set(
    dictionaryRows.map((row) => strFrom(row['Attribute Name'])),
  );

  if (dictionaryAttributeNames.size !== dictionaryRows.length) {
    throw new Error(
      'Attribute_Control_Dictionary has duplicate Attribute Name values.',
    );
  }

  const missingFromDictionary = [...controlAttributeNames].filter(
    (name) => !dictionaryAttributeNames.has(name),
  );
  const missingFromControls = [...dictionaryAttributeNames].filter(
    (name) => !controlAttributeNames.has(name),
  );

  if (missingFromDictionary.length > 0 || missingFromControls.length > 0) {
    throw new Error(
      `Dictionary/controls attribute-name mismatch. Missing from dictionary: ${missingFromDictionary.join(', ')}. Missing from controls: ${missingFromControls.join(', ')}.`,
    );
  }

  // --- Build rows, mapping every enum through its allow-list ------------------
  function mapEnum(
    map: Record<string, string>,
    raw: string,
    context: string,
  ): string {
    const mapped = map[raw];

    if (mapped === undefined) {
      throw new Error(
        `Unrecognized value "${raw}" for ${context}. Run with --discover-enums, review, and extend the allow-list before re-running.`,
      );
    }

    return mapped;
  }

  function splitAllowedValues(raw: string): string[] {
    if (raw === '') return [];

    return raw
      .split(';')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
  }

  const dictionary = dictionaryRows.map((row) => ({
    attributeName: strFrom(row['Attribute Name']),
    canonicalAttributeKey: strFrom(row['Canonical Attribute Key']),
    defaultInputControlType: mapEnum(
      INPUT_CONTROL_TYPE_MAP,
      strFrom(row['Default Input Control Type']),
      `Attribute_Control_Dictionary.Default Input Control Type (row: ${strFrom(row['Attribute Name'])})`,
    ),
    defaultAllowedValues: splitAllowedValues(
      strFrom(row['Default Allowed Values']),
    ),
    defaultAllowCustomValue: boolFrom(row['Default Allow Custom Value']),
    defaultAllowMultipleValues: boolFrom(row['Default Allow Multiple Values']),
    dataType: mapEnum(
      DATA_TYPE_MAP,
      strFrom(row['Data Type']),
      `Attribute_Control_Dictionary.Data Type (row: ${strFrom(row['Attribute Name'])})`,
    ),
    notes: strFrom(row.Notes) === '' ? null : strFrom(row.Notes),
  }));

  const controls = controlRows.map((row) => {
    const categoryCode = strFrom(row['Universal Category Code']);
    const attributeName = strFrom(row['Attribute Name']);
    const inputControlType = mapEnum(
      INPUT_CONTROL_TYPE_MAP,
      strFrom(row['Input Control Type']),
      `Category_Attribute_Controls.Input Control Type (${categoryCode}/${attributeName})`,
    );
    const allowedValues = splitAllowedValues(strFrom(row['Allowed Values']));
    const isDropdown = DROPDOWN_TYPES.has(inputControlType);

    if (isDropdown && allowedValues.length === 0) {
      throw new Error(
        `Dropdown control with no allowed values: ${categoryCode}/${attributeName}`,
      );
    }

    if (!isDropdown && allowedValues.length > 0) {
      throw new Error(
        `Non-dropdown control with allowed values: ${categoryCode}/${attributeName}`,
      );
    }

    return {
      categoryCode,
      attributeName,
      requirementLevel: mapEnum(
        REQUIREMENT_LEVEL_MAP,
        strFrom(row['Requirement Level']),
        `Category_Attribute_Controls.Requirement Level (${categoryCode}/${attributeName})`,
      ),
      inputControlType,
      allowedValues,
      allowCustomValue: boolFrom(row['Allow Custom Value']),
      allowMultipleValues: boolFrom(row['Allow Multiple Values']),
      sellerHelpText:
        strFrom(row['Seller Help Text']) === ''
          ? null
          : strFrom(row['Seller Help Text']),
      seoVisibility: mapEnum(
        SEO_VISIBILITY_MAP,
        strFrom(row['SEO Visibility']),
        `Category_Attribute_Controls.SEO Visibility (${categoryCode}/${attributeName})`,
      ),
      aeoGeoVisibility: mapEnum(
        AEO_GEO_VISIBILITY_MAP,
        strFrom(row['AEO/GEO Visibility']),
        `Category_Attribute_Controls.AEO/GEO Visibility (${categoryCode}/${attributeName})`,
      ),
      complianceReviewFlag: mapEnum(
        COMPLIANCE_REVIEW_FLAG_MAP,
        strFrom(row['Compliance Review Flag']),
        `Category_Attribute_Controls.Compliance Review Flag (${categoryCode}/${attributeName})`,
      ),
      sourceBasis:
        strFrom(row['Source Basis']) === ''
          ? null
          : strFrom(row['Source Basis']),
    };
  });

  const workbookBytes = readFileSync(WORKBOOK_PATH);
  const sha256 = createHash('sha256').update(workbookBytes).digest('hex');

  const output = {
    source: {
      workbook: 'universal_category_variation_taxonomy_final_clean.xlsx',
      sheet: 'Category_Attribute_Controls',
      sha256,
      controlsVersion: CONTROLS_VERSION,
      dictionaryRowCount: dictionary.length,
      controlRowCount: controls.length,
    },
    controlsVersion: CONTROLS_VERSION,
    dictionary,
    controls,
  };

  console.log(`Sheets present: ${actualSheetNames.join(', ')}`);
  console.log(`Categories in taxonomy sheet: ${taxonomyRows.length}`);
  console.log(`Attribute control rows: ${controls.length}`);
  console.log(`Dictionary entries: ${dictionary.length}`);
  console.log(`Workbook sha256: ${sha256}`);
  console.log('All regression guards passed.');

  if (dryRun) {
    console.log('\nDry run - nothing was written.');
    return;
  }

  const outputPath = join(seedDir, 'sals3-category-attribute-controls-v1.json');

  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

  console.log(`\nWrote ${outputPath}`);
}

main().catch((error: unknown) => {
  console.error(
    '[extract-category-attribute-controls]',
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
