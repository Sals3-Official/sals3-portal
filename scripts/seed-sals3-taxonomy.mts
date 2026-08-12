/* eslint-disable no-console -- this is a CLI script; status output is its job. */
/**
 * One-time seed: loads Sals3 Taxonomy v0 (ADR-002) into `sals3_categories`
 * from the static JSON extracted from
 * `sals3-ecommerce/docs/Raw/universal_category_variation_taxonomy.xlsx`'s
 * `Universal_Category_Taxonomy` sheet (1,345 rows, verified against
 * ADR-002's own stated row/L1-department counts). The workbook itself is
 * not read at runtime — no `.xlsx` parser is added to this app's
 * dependencies for a one-time import; `sals3-taxonomy-v0.json` is the
 * frozen extraction.
 *
 * Idempotent: `onConflictDoNothing` on the unique `code`, so re-running
 * this after the workbook is re-extracted only inserts genuinely new codes.
 * It does not update or remove an existing row — a real remap/versioning
 * policy (ADR-002 §3) is future work, not this script's job.
 *
 * NOT RUN as part of this change. Requires the migration this schema
 * belongs to to be generated and applied first (see
 * `CLAUDE_TURNOVER_CATEGORY_MARGIN_AND_FX_POLICY.txt`'s explicit "do not
 * migrate a database" instruction) — run only after that approval:
 *
 *   npm run seed:taxonomy
 *
 * See `scripts/bootstrap-sals3-official-cj.mts` for why this uses `tsx`,
 * extensionless relative imports, and its own single-connection client
 * instead of `src/lib/db/client.ts`'s pooled `getDb()`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { Database } from '../src/lib/db/client';
/* eslint-disable import/extensions -- extensionless is what actually works
   here, matching this codebase's own scripts/ convention. */
import { sals3Categories } from '../src/lib/db/schema/pricing-policy';

/**
 * Same three lines as `bootstrap-sals3-official-cj.mts`, and for the same
 * reason: `tsx` runs this outside Next.js, so nothing else loads `.env.local`.
 * Without it the script threw `DATABASE_URL is not set.` on a machine where
 * `DATABASE_URL` was correctly configured all along - the connection string
 * was simply in the file this never read.
 */
try {
  process.loadEnvFile('.env.local');
} catch {
  // No .env.local - env vars must already be exported in the shell.
}

const moduleDir = dirname(fileURLToPath(import.meta.url));

type TaxonomyRow = {
  code: string;
  l1: string | null;
  l2: string | null;
  l3: string | null;
  l4: string | null;
  l5: string | null;
  path: string;
  sourceNote: string | null;
};

function loadTaxonomyRows(): TaxonomyRow[] {
  const jsonPath = join(
    moduleDir,
    '../src/lib/db/seed-data/sals3-taxonomy-v0.json',
  );
  const raw = readFileSync(jsonPath, 'utf-8');
  const parsed: unknown = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error(`${jsonPath} did not contain a JSON array.`);
  }

  return parsed as TaxonomyRow[];
}

async function main() {
  const connectionString = process.env.DATABASE_URL;

  if (connectionString === undefined || connectionString === '') {
    throw new Error('DATABASE_URL is not set.');
  }

  const rows = loadTaxonomyRows();
  console.log(`Loaded ${rows.length} taxonomy rows from the frozen extract.`);

  const sql = postgres(connectionString, { max: 1 });
  const db: Database = drizzle(sql);

  try {
    const inserted = await db
      .insert(sals3Categories)
      .values(
        rows.map((row) => ({
          code: row.code,
          l1: row.l1,
          l2: row.l2,
          l3: row.l3,
          l4: row.l4,
          l5: row.l5,
          path: row.path,
          taxonomyStatus: 'ADOPTED' as const,
        })),
      )
      .onConflictDoNothing({ target: sals3Categories.code })
      .returning({ code: sals3Categories.code });

    console.log(
      `Inserted ${inserted.length} new categories (${
        rows.length - inserted.length
      } already present, left untouched).`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error('[seed-sals3-taxonomy] failed', error);
  process.exitCode = 1;
});
