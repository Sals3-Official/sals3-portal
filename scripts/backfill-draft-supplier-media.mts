/* eslint-disable no-console -- this is a CLI script; status output is its job. */
/**
 * One-off backfill: records the supplier image address for catalogue products
 * that were created before draft creation projected media.
 *
 * ## Why it is needed
 *
 * `create-draft.ts` now calls `projectSupplierMediaForProduct` inside its own
 * transaction, so every *new* import gets its `product_media_sources` row. Rows
 * created before that change have none — verified against production on
 * 2026-08-14: four draft products, zero media rows, while every one of their
 * candidates carried an image address in
 * `candidate_evaluations.feed_snapshot.imageUrl` the whole time. That is why the
 * Product Editor showed an empty grey square above Basic Information.
 *
 * ## What it does, and does not, do
 *
 * It calls the same projection the import and publish paths use — no second
 * definition of which addresses are allowed, which rights basis is recorded, or
 * how many images a product may carry. So it inherits the host allow-list, the
 * `SUPPLIER_TERMS`/`APPROVED` basis the owner declared on 2026-08-13, the
 * observation time from the evidence row (never `now()`), and the URL-level
 * dedupe that makes a re-run insert nothing.
 *
 * **Zero supplier calls.** Every address read here is already in the database.
 *
 * It writes nothing else: no title, no category, no variant. Category backfill
 * has its own script — `approve-cj-category-mapping.mts` re-resolves every
 * `UNMAPPED` product sourced from the category it approves.
 *
 * ## Usage
 *
 *   npx tsx scripts/backfill-draft-supplier-media.mts --dry-run
 *   ALLOW_REMOTE_DB_WRITE=1 npx tsx scripts/backfill-draft-supplier-media.mts
 *
 * A dry run reports, per product, which source would be used and how many
 * addresses it would record, and writes nothing.
 *
 * See `scripts/bootstrap-sals3-official-cj.mts` for why this uses `tsx`,
 * extensionless relative imports, and its own single-connection client instead
 * of `src/lib/db/client.ts`'s pooled `getDb()`.
 */
import { eq, isNotNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
/* eslint-disable import/extensions -- extensionless is what actually works
   here, matching this codebase's own scripts/ convention. */
import type { Database } from '../src/lib/db/client';
import {
  products,
  providerProductReferences,
} from '../src/lib/db/schema/product-catalog';
import {
  projectSupplierMediaForProduct,
  SUPPLIER_MEDIA_RIGHTS,
} from '../src/modules/catalog/products/media-projection';
import {
  ALLOW_REMOTE_ENV_VAR,
  decideRemoteWrite,
} from '../src/lib/db/remote-write-guard';

try {
  process.loadEnvFile('.env.local');
} catch {
  // No .env.local - env vars must already be exported in the shell.
}

/** Recorded as `created_by` on every row this writes. A platform action. */
const ACTOR_ID = 'platform-media-backfill-script';

const dryRun = process.argv.includes('--dry-run');

type Target = {
  productId: string;
  title: string;
  candidateId: string;
};

/**
 * Products sourced from a supplier candidate.
 *
 * No "does it already have media" filter: the projection dedupes by URL itself
 * and reports `inserted: 0`, so a re-run is a no-op without this script needing
 * its own second opinion about what counts as already recorded.
 *
 * Products with no `source_candidate_id` are skipped rather than reported as
 * failures: there is no candidate to read an address from, which is a fact about
 * the row, not an error.
 */
async function findTargets(db: Database): Promise<Target[]> {
  const rows = await db
    .select({
      productId: products.id,
      title: products.title,
      candidateId: providerProductReferences.sourceCandidateId,
    })
    .from(products)
    .innerJoin(
      providerProductReferences,
      eq(providerProductReferences.productId, products.id),
    )
    .where(isNotNull(providerProductReferences.sourceCandidateId))
    .orderBy(products.createdAt);

  return rows.flatMap((row) =>
    row.candidateId === null ? [] : [{ ...row, candidateId: row.candidateId }],
  );
}

/** Aborts a dry-run transaction while carrying the real projection result out. */
class DryRunRollback extends Error {
  constructor(
    readonly outcome: Awaited<
      ReturnType<typeof projectSupplierMediaForProduct>
    >,
  ) {
    super('dry run');
    this.name = 'DryRunRollback';
  }
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;

  if (connectionString === undefined || connectionString === '') {
    throw new Error('DATABASE_URL is not set.');
  }

  const decision = decideRemoteWrite({
    command: 'backfill-draft-supplier-media',
    connectionString,
    allowRemote: process.env[ALLOW_REMOTE_ENV_VAR],
  });

  if (!decision.allowed && !dryRun) {
    console.error(decision.message);
    process.exitCode = 1;

    return;
  }

  const sql = postgres(connectionString, { max: 1 });
  const db: Database = drizzle(sql);

  console.log(
    dryRun
      ? 'Mode: DRY RUN - nothing will be written.'
      : 'Mode: APPLY - media provenance rows will be inserted.',
  );

  try {
    const targets = await findTargets(db);

    console.log(`${targets.length} supplier-sourced catalogue product(s).`);

    let inserted = 0;
    let unchanged = 0;
    let withoutAddress = 0;

    // Sequential on purpose: each product is its own small transaction, and a
    // readable per-product log is worth more here than concurrency on a handful
    // of rows.
    // eslint-disable-next-line no-restricted-syntax
    for (const target of targets) {
      // A dry run must not insert, and the projection's only mode is to insert.
      // So it is called inside a transaction that is always rolled back, which
      // reports the *real* answer — which source, how many addresses — instead
      // of a re-implementation of the projection that could disagree with it.
      // eslint-disable-next-line no-await-in-loop
      const result = await db
        .transaction(async (tx) => {
          const outcome = await projectSupplierMediaForProduct(tx, {
            productId: target.productId,
            candidateId: target.candidateId,
            actorId: ACTOR_ID,
            rights: SUPPLIER_MEDIA_RIGHTS,
          });

          if (dryRun) throw new DryRunRollback(outcome);

          return outcome;
        })
        .catch((error: unknown) => {
          if (error instanceof DryRunRollback) return error.outcome;

          throw error;
        });

      if (result.source === 'NONE') {
        withoutAddress += 1;
        console.log(
          `  no stored address   ${target.productId}  ${target.title}`,
        );
        // eslint-disable-next-line no-continue
        continue;
      }

      if (result.inserted === 0) {
        unchanged += 1;
        console.log(
          `  already recorded    ${target.productId}  ${target.title}`,
        );
        // eslint-disable-next-line no-continue
        continue;
      }

      inserted += result.inserted;
      console.log(
        `  ${dryRun ? 'would record' : 'recorded'} ${result.inserted} (${result.source})  ${target.productId}  ${target.title}`,
      );
    }

    console.log(
      `\n${dryRun ? 'Would insert' : 'Inserted'} ${inserted} media row(s). ` +
        `${unchanged} product(s) already had every address, ` +
        `${withoutAddress} have no stored address at all.`,
    );

    if (dryRun) console.log('Dry run - nothing was written.');
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error('[backfill-draft-supplier-media] failed', error);
  process.exitCode = 1;
});
