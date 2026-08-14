/* eslint-disable no-console -- this is a CLI script; status output is its job. */
/**
 * One-off backfill: records the supplier's own variant label for catalogue
 * variants that were created before draft creation stored it.
 *
 * ## Why it is needed
 *
 * `provider_variant_references.source_option_label` has exactly one writer —
 * `create-draft.ts`, at draft time, from `evidence.variants[].optionLabel`. There
 * is no other writer and no backfill, so every variant drafted before that
 * writer shipped carries `NULL`.
 *
 * That single NULL is enough to disable option mapping for the whole product.
 * `deriveOptionSplit` refuses when *any* variant has no label, because a partial
 * proposal would silently omit the unlabelled variants — so the Product Editor
 * shows "Not detected" and the seller cannot name Colour or Size, no matter how
 * clean the remaining labels are. On a catalogue where only the newest product
 * was drafted after the writer landed, that reads as "the feature only works on
 * one item".
 *
 * ## Where the labels come from
 *
 * `supplier_snapshots.evidence`, which is unique on `candidate_id` and
 * overwritten in place, so it always holds the current supplier truth. The labels
 * have been sitting there the whole time — `captureCandidateEvidence` stores
 * `optionLabel` per variant, and `create-draft.ts` reads that exact field.
 *
 * **Zero supplier calls.** Every label read here is already in the database. No
 * CJ request, no points (ADR-017).
 *
 * ## What it will not do
 *
 * It only fills `NULL`. A label already on a row is supplier content this script
 * must never overwrite — that is the field-ownership rule, and it is also what
 * keeps re-runs safe and makes this idempotent without a second opinion about
 * what counts as already recorded.
 *
 * That restriction also settles a design question worth stating. The change
 * detector treats `provider_variant_references` as frozen at draft time and diffs
 * it against the current snapshot to find "what changed since the seller drafted
 * this". Writing current-snapshot labels into that table does partially defeat
 * that for the rows it touches — but only rows where the column is `NULL`, which
 * carry no draft-time observation to lose. Nothing detectable is destroyed; a
 * column that could answer no question before can answer one now.
 *
 * It writes nothing else. Not the SKU, not the cost, not the inventory — those
 * are live observations with their own write paths, and a backfill that quietly
 * refreshed them would be indistinguishable from a real supplier change.
 *
 * ## Matching
 *
 * Evidence variants carry CJ's `vid`; the reference rows carry it as
 * `external_variant_id`. That is the join. Sals3 SKUs are deliberately not used:
 * they are hashes computed by Sals3 and mean nothing to the supplier payload.
 *
 * ## Usage
 *
 *   npm run backfill:option-labels -- --dry-run
 *   ALLOW_REMOTE_DB_WRITE=1 npm run backfill:option-labels
 *
 * A dry run reports, per product, how many labels would be filled and whether the
 * result would make the product mappable, and writes nothing — the updates are
 * issued inside a transaction that is always rolled back, so the count reported is
 * the database's own answer rather than a re-implementation of the write.
 *
 * ### Why the npm script has no `guard-remote-db.mts` prefix
 *
 * Every other write command in `package.json` carries that prefix. This one
 * deliberately does not, and the reason matters: the prefix refuses before the
 * guarded process starts, which would also block `--dry-run` against production.
 * Pointing a dry run at production is the entire point — it is how you learn what
 * this would do to real rows before it does it.
 *
 * The guard is not skipped, only moved inside. `decideRemoteWrite` runs in `main`
 * and refuses a remote *apply* without `ALLOW_REMOTE_DB_WRITE`, while letting a
 * remote dry run through. That is only safe because the dry run truly writes
 * nothing; if that ever stops being true, this decision has to change with it.
 *
 * See `scripts/bootstrap-sals3-official-cj.mts` for why this uses `tsx`,
 * extensionless relative imports, and its own single-connection client instead
 * of `src/lib/db/client.ts`'s pooled `getDb()`.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { z } from 'zod';
/* eslint-disable import/extensions -- extensionless is what actually works
   here, matching this codebase's own scripts/ convention. */
import type { Database } from '../src/lib/db/client';
import {
  products,
  productVariants,
  providerProductReferences,
  providerVariantReferences,
} from '../src/lib/db/schema/product-catalog';
import { supplierSnapshots } from '../src/lib/db/schema/catalog';
import deriveOptionSplit from '../src/modules/catalog/products/option-split';
import {
  ALLOW_REMOTE_ENV_VAR,
  decideRemoteWrite,
} from '../src/lib/db/remote-write-guard';

try {
  process.loadEnvFile('.env.local');
} catch {
  // No .env.local - env vars must already be exported in the shell.
}

const dryRun = process.argv.includes('--dry-run');

/**
 * Re-validated rather than trusted, and mirroring `create-draft.ts`'s
 * `storedVariantSchema`: the snapshot may have been written by an older
 * `EVIDENCE_SCHEMA_VERSION`, and a shape mismatch must degrade to "no usable
 * labels" instead of throwing partway through.
 */
const storedVariantSchema = z.object({
  vid: z.string().min(1),
  optionLabel: z.string().nullish(),
});

const storedEvidenceSchema = z.object({
  variants: z.array(storedVariantSchema).default([]),
});

type Candidate = {
  productId: string;
  title: string;
  evidence: unknown;
};

/**
 * Aborts a dry-run transaction while carrying the real count out.
 *
 * The updates are issued either way, so the count reported is what the database
 * itself decided to change rather than this script's guess about it — then the
 * throw rolls all of it back. Same device as
 * `backfill-draft-supplier-media.mts`, and for the same reason: a dry run that
 * re-implemented the write in order to preview it could disagree with the write.
 */
class DryRunRollback extends Error {
  constructor(readonly count: number) {
    super('dry run');
    this.name = 'DryRunRollback';
  }
}

/**
 * Every catalogue product that has a stored supplier snapshot to read from.
 *
 * No "does it already have labels" filter here: the per-variant `isNull`
 * predicate on the update is what makes this idempotent, and counting rows that
 * were already filled is useful output rather than something to hide.
 */
async function findCandidates(db: Database): Promise<Candidate[]> {
  return db
    .select({
      productId: products.id,
      title: products.title,
      evidence: supplierSnapshots.evidence,
    })
    .from(products)
    .innerJoin(
      providerProductReferences,
      eq(providerProductReferences.productId, products.id),
    )
    .innerJoin(
      supplierSnapshots,
      eq(
        supplierSnapshots.candidateId,
        providerProductReferences.sourceCandidateId,
      ),
    )
    .orderBy(products.createdAt);
}

/** The labels this product's variants would end up with, for the split preview. */
async function labelsAfter(
  db: Database,
  productId: string,
): Promise<{ variantId: string; label: string | null }[]> {
  return db
    .select({
      variantId: productVariants.id,
      label: providerVariantReferences.sourceOptionLabel,
    })
    .from(productVariants)
    .leftJoin(
      providerVariantReferences,
      eq(providerVariantReferences.variantId, productVariants.id),
    )
    .where(eq(productVariants.productId, productId));
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;

  if (connectionString === undefined || connectionString === '') {
    throw new Error('DATABASE_URL is not set.');
  }

  const decision = decideRemoteWrite({
    command: 'backfill-supplier-option-labels',
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
      : 'Mode: APPLY - missing supplier labels will be recorded.',
  );

  try {
    const candidates = await findCandidates(db);

    console.log(`${candidates.length} product(s) with a stored snapshot.\n`);

    let filled = 0;
    let mappableAfter = 0;
    let stillNotMappable = 0;

    // Sequential on purpose: each product is its own small transaction, and a
    // readable per-product log is worth more than concurrency on a dozen rows.
    // eslint-disable-next-line no-restricted-syntax
    for (const candidate of candidates) {
      const parsed = storedEvidenceSchema.safeParse(candidate.evidence);

      if (!parsed.success) {
        console.log(`  unreadable snapshot  ${candidate.title}`);
        // eslint-disable-next-line no-continue
        continue;
      }

      const labelled = parsed.data.variants.flatMap((variant) =>
        variant.optionLabel === null ||
        variant.optionLabel === undefined ||
        variant.optionLabel.trim() === ''
          ? []
          : [{ vid: variant.vid, label: variant.optionLabel.trim() }],
      );

      /**
       * This product's own variant ids, and the reason the update is scoped by
       * them.
       *
       * `external_variant_id` is CJ's identifier, not a Sals3 one, and nothing
       * makes it unique across the table: two products — or two *sellers* — can
       * legitimately reference the same CJ variant. Matching on the vid alone
       * would write labels onto reference rows belonging to another product and,
       * worse, another tenant. Scoping to the ids read here keeps the write inside
       * the product being processed.
       */
      // eslint-disable-next-line no-await-in-loop
      const ownVariantIds = (await labelsAfter(db, candidate.productId)).map(
        (row) => row.variantId,
      );

      // eslint-disable-next-line no-await-in-loop
      const written = await db
        .transaction(async (tx) => {
          let count = 0;

          if (ownVariantIds.length === 0) return count;

          // eslint-disable-next-line no-restricted-syntax
          for (const entry of labelled) {
            // `isNull` in the predicate, not a read-then-write: it makes the
            // "only fill blanks" rule the database's decision rather than this
            // script's, so a concurrent write cannot slip between the two.
            // eslint-disable-next-line no-await-in-loop
            const rows = await tx
              .update(providerVariantReferences)
              .set({ sourceOptionLabel: entry.label })
              .where(
                and(
                  inArray(providerVariantReferences.variantId, ownVariantIds),
                  eq(providerVariantReferences.externalVariantId, entry.vid),
                  isNull(providerVariantReferences.sourceOptionLabel),
                ),
              )
              .returning({ id: providerVariantReferences.id });

            count += rows.length;
          }

          if (dryRun) throw new DryRunRollback(count);

          return count;
        })
        .catch((error: unknown) => {
          if (error instanceof DryRunRollback) return error.count;

          throw error;
        });

      // Read back inside the same run so the preview reflects what was just
      // written — or, in a dry run, what is there now without this script.
      // eslint-disable-next-line no-await-in-loop
      const after = await labelsAfter(db, candidate.productId);
      const split = deriveOptionSplit(after);
      const shape =
        split === undefined
          ? 'no clean grid'
          : `${split.positions.map((position) => position.values.length).join(' x ')}`;

      if (split === undefined) stillNotMappable += 1;
      else mappableAfter += 1;

      filled += written;

      console.log(
        `  ${dryRun ? 'would fill' : 'filled'} ${String(written).padStart(3)}  ${shape.padEnd(14)}  ${candidate.title}`,
      );

      if (dryRun && written > 0) {
        // A dry run cannot show the post-fill split, because the fill did not
        // happen. Saying so is better than printing the pre-fill shape as if it
        // were the outcome.
        console.log(
          `        (shape above is BEFORE the fill; re-run without --dry-run to see the result)`,
        );
      }
    }

    console.log(
      `\n${dryRun ? 'Would fill' : 'Filled'} ${filled} label(s). ` +
        `${mappableAfter} product(s) now derive a clean grid, ` +
        `${stillNotMappable} still do not and stay unmappable by design.`,
    );

    if (dryRun) console.log('Dry run - nothing was written.');
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error('[backfill-supplier-option-labels] failed', error);
  process.exitCode = 1;
});
