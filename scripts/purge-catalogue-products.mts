/* eslint-disable no-console -- this is a CLI script; status output is its job. */
/**
 * One-off operation: permanently removes every Sals3 catalogue product and all
 * of its dependent rows - revisions, variants, options, provider references,
 * offers, supplier bindings, media sources - plus the draft-creation
 * idempotency records that would otherwise replay a result for a product that
 * no longer exists.
 *
 * Why this exists: PR #64 shipped a "bulk add to Product Catalogue" flow that
 * wrote real rows, and PR #65 built on it. Both were reverted (PR #66) at the
 * owner's request. A code revert does not delete data, so those rows stayed -
 * unreachable from every page at the reverted commit, and invisible to the
 * storefront, which reads CJ live and never touches `products`. The owner asked
 * for a clean slate rather than inert leftovers.
 *
 * Run with (dry run - counts and a row listing, changes nothing):
 *   vercel --cwd <portal> env run -e production -- npx tsx scripts/purge-catalogue-products.mts
 *
 * Then, to actually delete:
 *   ... scripts/purge-catalogue-products.mts --apply
 *
 * `vercel env run` rather than `vercel env pull`: pull writes production
 * secrets to a file on disk, run only injects them into this process.
 *
 * Follows `purge-dev-user-cj-connection.mts` in every structural choice - its
 * own header explains each one. Raw SQL rather than Drizzle for the same
 * reason: the delete ORDER is the entire correctness argument here, and raw
 * statements state that order plainly.
 *
 * `audit_events` rows are deliberately NOT deleted. They have no foreign key
 * (`entity_id` is plain text), so they never block the delete, and once the
 * rows are gone the audit trail is the only remaining record that these
 * products ever existed. The sibling purge script made the same call.
 */
import { writeFileSync } from 'node:fs';
import postgres from 'postgres';
/* eslint-disable-next-line import/extensions -- extensionless is what
   resolves under tsx; see bootstrap-sals3-official-cj.mts's own note. */
import { CREATE_PRODUCT_DRAFT_OPERATION } from '../src/modules/catalog/products/contracts';

const ACTOR_ID = 'system:purge-catalogue-products';

try {
  process.loadEnvFile('.env.local');
} catch {
  // No .env.local - env vars must already be exported in the shell.
}

const apply = process.argv.includes('--apply');

/**
 * `DATABASE_URL_UNPOOLED` first: this script runs one long transaction, and
 * Neon's pooled endpoint is the wrong shape for that.
 */
function resolveConnectionString(): string {
  const url =
    process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? '';

  if (url === '') throw new Error('DATABASE_URL is not set.');

  return url;
}

/**
 * Inverted relative to the npm `db:*` guard, and deliberately so: the portal's
 * own `.env.local` points `DATABASE_URL` at a localhost database, and loading
 * it can shadow the production value injected by `vercel env run`. A purge that
 * silently ran against the wrong database would look like a success.
 */
function assertNotLocalDatabase(url: string): string {
  const { host } = new URL(url);

  console.log(`Database host: ${host}`);

  if (/^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host)) {
    throw new Error(
      'Refusing to run: this is a LOCAL database. Production env was not injected - run under `vercel env run -e production`.',
    );
  }

  return host;
}

const connectionString = resolveConnectionString();
const host = assertNotLocalDatabase(connectionString);
const sql = postgres(connectionString, { max: 1, ssl: 'require' });

type Row = Record<string, unknown>;

/**
 * Read every row that is about to be destroyed, so the backup is complete
 * rather than a summary. Order here is presentation only - the delete order
 * below is the one that matters.
 */
async function readAll() {
  const [
    products,
    revisions,
    variants,
    options,
    optionValues,
    variantOptionValues,
    providerProductRefs,
    providerVariantRefs,
    offers,
    bindings,
    mediaSources,
    idempotency,
  ] = await Promise.all([
    sql<Row[]>`select * from products order by created_at`,
    sql<Row[]>`select * from product_revisions`,
    sql<Row[]>`select * from product_variants`,
    sql<Row[]>`select * from product_options`,
    sql<Row[]>`select * from product_option_values`,
    sql<Row[]>`select * from product_variant_option_values`,
    sql<Row[]>`select * from provider_product_references`,
    sql<Row[]>`select * from provider_variant_references`,
    sql<Row[]>`select * from product_offers`,
    sql<Row[]>`select * from offer_supplier_bindings`,
    sql<Row[]>`select * from product_media_sources`,
    sql<
      Row[]
    >`select * from idempotency_records where operation = ${CREATE_PRODUCT_DRAFT_OPERATION}`,
  ]);

  return {
    products,
    revisions,
    variants,
    options,
    optionValues,
    variantOptionValues,
    providerProductRefs,
    providerVariantRefs,
    offers,
    bindings,
    mediaSources,
    idempotency,
  };
}

async function main(): Promise<void> {
  console.log(
    apply
      ? '\nMode: APPLY - rows will be permanently deleted.\n'
      : '\nMode: DRY RUN - nothing will be written. Pass --apply to delete.\n',
  );

  const rows = await readAll();

  console.log('Rows found:');
  console.log(`  products                      : ${rows.products.length}`);
  console.log(`  product_revisions             : ${rows.revisions.length}`);
  console.log(`  product_variants              : ${rows.variants.length}`);
  console.log(`  product_options               : ${rows.options.length}`);
  console.log(`  product_option_values         : ${rows.optionValues.length}`);
  console.log(
    `  product_variant_option_values : ${rows.variantOptionValues.length}`,
  );
  console.log(
    `  provider_product_references   : ${rows.providerProductRefs.length}`,
  );
  console.log(
    `  provider_variant_references   : ${rows.providerVariantRefs.length}`,
  );
  console.log(`  product_offers                : ${rows.offers.length}`);
  console.log(`  offer_supplier_bindings       : ${rows.bindings.length}`);
  console.log(`  product_media_sources         : ${rows.mediaSources.length}`);
  console.log(`  idempotency_records (draft)   : ${rows.idempotency.length}`);

  if (rows.products.length === 0) {
    console.log('\nNo catalogue products exist. Nothing to do.');

    return;
  }

  // Printed in full, every run: this is the review surface. An unexpected row
  // count or an unfamiliar steward account is the signal to stop rather than
  // pass --apply.
  console.log('\nProducts that would be deleted:');
  rows.products.forEach((product) => {
    console.log(
      `  ${product.id as string}  ${product.publication_state as string}  steward=${product.steward_seller_account_id as string}  created=${new Date(product.created_at as string).toISOString()}  ${product.title as string}`,
    );
  });

  const published = rows.products.filter(
    (product) => product.publication_state === 'PUBLISHED',
  );

  if (published.length > 0) {
    console.log(
      `\nNOTE: ${published.length} product(s) are PUBLISHED. They will be moved to UNPUBLISHED first - the products_published_requires_revision CHECK rejects the implicit SET NULL on the revision pointer otherwise.`,
    );
  }

  if (!apply) {
    console.log('\nDry run complete. No changes were made.');

    return;
  }

  // Written before the transaction opens, so a backup always exists on disk by
  // the time the first DELETE runs.
  const backupPath = `${process.cwd()}/purge-catalogue-products-backup.json`;

  writeFileSync(
    backupPath,
    JSON.stringify(
      { purgedAt: new Date().toISOString(), databaseHost: host, ...rows },
      null,
      2,
    ),
  );

  console.log(`\nBackup written: ${backupPath}`);

  const expectedProducts = rows.products.length;

  const deleted = await sql.begin(async (tx) => {
    // 1-2. Break the products <-> product_revisions cycle. `products` cannot go
    // first (product_revisions.product_id is RESTRICT), and deleting revisions
    // fires ON DELETE SET NULL on the pointers below - an UPDATE that
    // re-evaluates products_published_requires_revision. So PUBLISHED rows must
    // step down first, then the pointers are cleared explicitly.
    await tx`
      update products set publication_state = 'UNPUBLISHED'
      where publication_state = 'PUBLISHED'
    `;
    await tx`
      update products set current_revision_id = null, published_revision_id = null
    `;

    // 3-6. Every RESTRICT edge, innermost first. Omitting any one of these
    // raises a foreign-key violation rather than cascading.
    const bindings = await tx`delete from offer_supplier_bindings`;
    const offers = await tx`delete from product_offers`;
    const providerVariantRefs =
      await tx`delete from provider_variant_references`;
    const providerProductRefs =
      await tx`delete from provider_product_references`;

    // 7-10. Option and media tables. Nothing in the application writes these -
    // there is no insert for any of them anywhere in the repo - so they are
    // expected empty. Deleted explicitly anyway: relying on a cascade that has
    // never been exercised is not the same as knowing they are gone.
    const mediaSources = await tx`delete from product_media_sources`;
    const variantOptionValues =
      await tx`delete from product_variant_option_values`;
    const optionValues = await tx`delete from product_option_values`;
    const options = await tx`delete from product_options`;

    // 11-13.
    const variants = await tx`delete from product_variants`;
    const revisions = await tx`delete from product_revisions`;
    const products = await tx`delete from products`;

    if (products.count !== expectedProducts) {
      // Something raced us, or a dependency we did not know about held a row.
      // Rolling back is the only honest outcome - a partial purge leaves
      // orphans that are harder to reason about than the original leftovers.
      throw new Error(
        `Expected to delete ${expectedProducts} products, deleted ${products.count}. Rolling back.`,
      );
    }

    // 14. The trap this script exists to close as much as the rows themselves.
    // `idempotency_records.expires_at` is never read and never swept - the only
    // lookup filters on `key` alone. Left behind, a re-add reusing a spent key
    // replays a stored result naming a product id that no longer exists, and
    // reports it as created.
    const idempotency = await tx`
      delete from idempotency_records
      where operation = ${CREATE_PRODUCT_DRAFT_OPERATION}
    `;

    const counts = {
      offerSupplierBindings: bindings.count,
      productOffers: offers.count,
      providerVariantReferences: providerVariantRefs.count,
      providerProductReferences: providerProductRefs.count,
      productMediaSources: mediaSources.count,
      productVariantOptionValues: variantOptionValues.count,
      productOptionValues: optionValues.count,
      productOptions: options.count,
      productVariants: variants.count,
      productRevisions: revisions.count,
      products: products.count,
      idempotencyRecords: idempotency.count,
    };

    // The audit trail is the only record left that this happened - the rows
    // themselves are gone. Earlier catalog_product.* events are deliberately
    // left in place.
    await tx`
      insert into audit_events (actor_id, action, entity_type, entity_id, payload)
      values (
        ${ACTOR_ID},
        'catalog_product.purged',
        'Product',
        'all',
        ${tx.json({
          reason:
            'PRs #64 and #65 reverted in PR #66; owner asked for the leftover rows to be removed.',
          deleted: counts,
          productIds: rows.products.map((product) => product.id as string),
          backupPath,
        })}
      )
    `;

    return counts;
  });

  console.log('\nDeleted:');
  Object.entries(deleted).forEach(([table, count]) => {
    console.log(`  ${table.padEnd(30)}: ${count}`);
  });
  console.log(
    '\nThe catalogue is empty. audit_events was left intact, plus one new catalog_product.purged row.',
  );
}

try {
  await main();
} finally {
  await sql.end();
}
