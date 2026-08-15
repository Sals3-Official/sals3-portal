/* eslint-disable no-console -- this is a CLI script; status output is its job. */
/**
 * Approves one CJ→Sals3 category mapping, then applies it to the products
 * sourced from that CJ category.
 *
 * ## Why this is a script and not a screen
 *
 * Category governance is platform authority, not tenant authority.
 * `modules/catalog/taxonomy/authorization.ts` denies it to **every** portal
 * role including `admin`, and `taxonomy/boundaries.test.ts` asserts that
 * nothing under `src/app` imports `taxonomy/{governance,repository,
 * product-category}`. A Server Action would fail that test, and rightly: a
 * seller approving their own taxonomy mapping is a seller choosing which
 * pricing policy applies to their product.
 *
 * So the split is deliberate. Platform-owned steps live here; tenant-owned
 * steps (market profile, category margin, funding buffer, publish) live in
 * `/market-rules` and `/listings`.
 *
 * ## What it does, in order
 *
 * 1. Resolves the Sals3 category by its taxonomy code (must already be seeded
 *    by `npm run seed:taxonomy-v1`).
 * 2. Proposes a mapping for the CJ category id, then reviews it to `ACTIVE`
 *    with the confidence given on the command line.
 * 3. For every product whose provider reference came from that CJ category,
 *    asks `applyResolvedCategoryToProduct` to re-resolve. That function has no
 *    category parameter — it writes whatever the resolver returns — so this
 *    script cannot force a category onto a product that the approved mapping
 *    does not actually cover.
 *
 * ## Usage
 *
 *   tsx scripts/approve-cj-category-mapping.mts \
 *     --external-category-id 2409230540351618000 \
 *     --sals3-code CAT-APP-100412 \
 *     --confidence EXACT \
 *     --reason "CJ Men's Jackets maps 1:1 to Sals3 Apparel > Outerwear > Men's Jackets" \
 *     [--observed-path "Men's Jackets"] [--dry-run]
 *
 * `--confidence` accepts `EXACT` or `ACCEPTABLE` only. `AMBIGUOUS` and
 * `UNMAPPED` are review outcomes, not approvals: recording one here would
 * assert an approval that the resolver will then refuse to act on.
 *
 * Writing to a non-local database still requires `ALLOW_REMOTE_DB_WRITE=1`,
 * the same guard every other write command carries.
 *
 * See `scripts/bootstrap-sals3-official-cj.mts` for why this uses `tsx`,
 * extensionless relative imports, and its own single-connection client instead
 * of `src/lib/db/client.ts`'s pooled `getDb()`.
 */
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
/* eslint-disable import/extensions -- extensionless is what actually works
   here, matching this codebase's own scripts/ convention. */
import type { Database } from '../src/lib/db/client';
import { ACTIVE_TAXONOMY_VERSION } from '../src/lib/db/schema/category-mapping';
import {
  products,
  providerProductReferences,
} from '../src/lib/db/schema/product-catalog';
import { supplierCandidates } from '../src/lib/db/schema/catalog';
import {
  findActiveMapping,
  findCategoryByCode,
  insertMappingProposal,
  reviewMapping,
} from '../src/modules/catalog/taxonomy/repository';
import { applyResolvedCategoryToProduct } from '../src/modules/catalog/taxonomy/product-category';
import {
  ALLOW_REMOTE_ENV_VAR,
  decideRemoteWrite,
} from '../src/lib/db/remote-write-guard';

try {
  process.loadEnvFile('.env.local');
} catch {
  // No .env.local - env vars must already be exported in the shell.
}

const APPROVABLE_CONFIDENCES = ['EXACT', 'ACCEPTABLE'] as const;

type ApprovableConfidence = (typeof APPROVABLE_CONFIDENCES)[number];

type Args = {
  externalCategoryId: string;
  sals3Code: string;
  confidence: ApprovableConfidence;
  reason: string;
  observedPath: string | null;
  dryRun: boolean;
};

/** The identity recorded as the approver. Platform action, not a seller. */
const ACTOR_ID = 'platform-taxonomy-script';

function readArgs(): Args {
  const argv = process.argv.slice(2);
  const value = (flag: string): string | null => {
    const index = argv.indexOf(flag);

    return index === -1 ? null : (argv[index + 1] ?? null);
  };

  const externalCategoryId = value('--external-category-id');
  const sals3Code = value('--sals3-code');
  const confidence = value('--confidence');
  const reason = value('--reason');

  if (
    externalCategoryId === null ||
    sals3Code === null ||
    confidence === null ||
    reason === null
  ) {
    throw new Error(
      'Required: --external-category-id, --sals3-code, --confidence, --reason. See this file’s doc comment.',
    );
  }

  if (!APPROVABLE_CONFIDENCES.includes(confidence as ApprovableConfidence)) {
    throw new Error(
      `--confidence must be one of ${APPROVABLE_CONFIDENCES.join(', ')}. ` +
        'AMBIGUOUS and UNMAPPED are review outcomes, not approvals.',
    );
  }

  if (reason.trim().length < 10) {
    throw new Error(
      '--reason must be a real sentence: it is the durable record of why this mapping was approved.',
    );
  }

  return {
    externalCategoryId,
    sals3Code,
    confidence: confidence as ApprovableConfidence,
    reason,
    observedPath: value('--observed-path'),
    dryRun: argv.includes('--dry-run'),
  };
}

async function approveMapping(
  db: Database,
  args: Args,
): Promise<{ mappingId: string; mappingVersion: number }> {
  const category = await findCategoryByCode(db, args.sals3Code);

  if (category === null) {
    throw new Error(
      `No sals3_categories row with code ${args.sals3Code}. Run \`npm run seed:taxonomy-v1\` first.`,
    );
  }

  const existing = await findActiveMapping(
    db,
    'CJ_DROPSHIPPING',
    args.externalCategoryId,
  );

  if (existing !== null) {
    console.log(
      `An ACTIVE mapping already exists for CJ category ${args.externalCategoryId} ` +
        `(version ${existing.mapping.mappingVersion}, confidence ${existing.mapping.confidence}). Leaving it untouched.`,
    );

    return {
      mappingId: existing.mapping.id,
      mappingVersion: existing.mapping.mappingVersion,
    };
  }

  const proposal = await insertMappingProposal(db, {
    provider: 'CJ_DROPSHIPPING',
    externalCategoryId: args.externalCategoryId,
    observedCategoryPath: args.observedPath,
    sals3CategoryId: category.id,
    taxonomyVersion: ACTIVE_TAXONOMY_VERSION,
    mappingVersion: 1,
    supersedesId: null,
    // An approval keyed to CJ's own category id, not to a path string that
    // CJ can reword. `REVIEWED_PATH_RULE` would claim the path was the basis.
    method: 'EXTERNAL_ID_RULE',
    confidence: args.confidence,
    reason: args.reason,
    evidenceReference: null,
    actorId: ACTOR_ID,
  });

  if (proposal === null) {
    throw new Error(
      `A version-1 proposal already exists for CJ category ${args.externalCategoryId} but is not ACTIVE. ` +
        'Review it directly rather than proposing over it.',
    );
  }

  const reviewed = await reviewMapping(db, {
    mappingId: proposal.id,
    expectedStatus: 'PROPOSED',
    expectedMappingVersion: proposal.mappingVersion,
    nextReviewStatus: 'APPROVED',
    nextStatus: 'ACTIVE',
    reason: args.reason,
    reviewedBy: ACTOR_ID,
  });

  if (reviewed === null) {
    throw new Error(
      'The proposal moved between proposing and reviewing it. Re-run to see the current state.',
    );
  }

  console.log(
    `Approved mapping ${reviewed.id} (v${reviewed.mappingVersion}, ${reviewed.confidence}) ` +
      `for CJ category ${args.externalCategoryId} -> ${args.sals3Code}.`,
  );

  return {
    mappingId: reviewed.id,
    mappingVersion: reviewed.mappingVersion,
  };
}

/**
 * The products sourced from this CJ category, found through the candidate that
 * produced each provider reference. `supplier_candidates.provider_category_id`
 * is the recorded provider category; nothing here guesses from a name.
 */
async function findProductsForCjCategory(
  db: Database,
  externalCategoryId: string,
): Promise<{ id: string; title: string; version: number; steward: string }[]> {
  return db
    .select({
      id: products.id,
      title: products.title,
      version: products.version,
      steward: products.stewardSellerAccountId,
    })
    .from(products)
    .innerJoin(
      providerProductReferences,
      eq(providerProductReferences.productId, products.id),
    )
    .innerJoin(
      supplierCandidates,
      eq(supplierCandidates.id, providerProductReferences.sourceCandidateId),
    )
    .where(
      and(
        eq(supplierCandidates.providerCategoryId, externalCategoryId),
        eq(products.categoryMappingConfidence, 'UNMAPPED'),
      ),
    );
}

async function main() {
  const args = readArgs();
  const connectionString = process.env.DATABASE_URL;

  if (connectionString === undefined || connectionString === '') {
    throw new Error('DATABASE_URL is not set.');
  }

  const decision = decideRemoteWrite({
    command: 'approve-cj-category-mapping',
    connectionString,
    allowRemote: process.env[ALLOW_REMOTE_ENV_VAR],
  });

  if (!decision.allowed && !args.dryRun) {
    console.error(decision.message);
    process.exitCode = 1;
    return;
  }

  const sql = postgres(connectionString, { max: 1 });
  const db: Database = drizzle(sql);

  try {
    const candidates = await findProductsForCjCategory(
      db,
      args.externalCategoryId,
    );

    console.log(
      `${candidates.length} unmapped product(s) sourced from CJ category ${args.externalCategoryId}.`,
    );

    if (args.dryRun) {
      candidates.forEach((product) => {
        console.log(`  would remap: ${product.id}  ${product.title}`);
      });
      console.log('Dry run - nothing was written.');
      return;
    }

    await approveMapping(db, args);

    // Sequential: each call is a compare-and-set on its own product version,
    // and a readable log of which product got which outcome is worth more here
    // than concurrency on a handful of rows.
    // eslint-disable-next-line no-restricted-syntax
    for (const product of candidates) {
      // eslint-disable-next-line no-await-in-loop
      const outcome = await applyResolvedCategoryToProduct(db, {
        productId: product.id,
        stewardSellerAccountId: product.steward,
        providerCategory: {
          provider: 'CJ_DROPSHIPPING',
          externalCategoryId: args.externalCategoryId,
          observedCategoryPath: args.observedPath,
        },
        taxonomyVersion: ACTIVE_TAXONOMY_VERSION,
        expectedProductVersion: product.version,
        actorId: ACTOR_ID,
      });

      console.log(`  ${outcome.outcome.padEnd(26)} ${product.title}`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error('[approve-cj-category-mapping] failed', error);
  process.exitCode = 1;
});
