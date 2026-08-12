/* eslint-disable no-console -- this is a CLI script; status output is its job. */
/**
 * One-off operation: permanently removes the CJ supplier connection held by
 * the Sals3 Official seller account (`identity_id = 'dev-user'`), together
 * with its encrypted secret, every `supplier_candidates` row sourced through
 * it, and the permanent `supplier_account_bindings` row that claims the CJ
 * provider account.
 *
 * Why this exists: the `dev-user` seller account is a bootstrap artefact with
 * no `auth_users` row, and the test-auth bypass that once produced that
 * identity is disabled in production (`src/lib/auth/session.ts`). Nobody can
 * sign in as `dev-user`, so its connection is unreachable through
 * `/supplier-apps` - while the append-only binding still refuses every other
 * seller's attempt to connect the same CJ account with `cj_account_taken`.
 * Only a direct database operation can release it.
 *
 * Run with (dry run - counts only, changes nothing):
 *   vercel --cwd <portal> env run -e production -- npx tsx scripts/purge-dev-user-cj-connection.mts
 *
 * Then, to actually delete:
 *   ... scripts/purge-dev-user-cj-connection.mts --apply
 *
 * `vercel env run` rather than `vercel env pull`: pull writes production
 * secrets to a file on disk, run only injects them into this process.
 *
 * Runs under `tsx` for the same reason `bootstrap-sals3-official-cj.mts`
 * does, and like that script opens its own single-connection client rather
 * than reusing `src/lib/db/client.ts`'s pooled `getDb()` - a one-shot script
 * has no use for a hot-reload-aware pool. Raw SQL rather than Drizzle here on
 * purpose: the delete ORDER is the entire correctness argument of this
 * script, and raw statements state that order plainly.
 *
 * Imports only modules with no `server-only` guard - see the bootstrap
 * script's header for why that guard breaks outside Next.js's bundler.
 */
import { writeFileSync } from 'node:fs';
import postgres from 'postgres';
/* eslint-disable-next-line import/extensions -- extensionless is what
   resolves under tsx; see bootstrap-sals3-official-cj.mts's own note. */
import { SALS3_OFFICIAL_IDENTITY_ID } from '../src/lib/auth/identity';

const PROVIDER_CODE = 'CJ_DROPSHIPPING';
const ACTOR_ID = 'system:purge-dev-user-cj-connection';

try {
  process.loadEnvFile('.env.local');
} catch {
  // No .env.local - env vars must already be exported in the shell.
}

const apply = process.argv.includes('--apply');

/**
 * `DATABASE_URL_UNPOOLED` first: this script runs one long transaction, and
 * Neon's pooled endpoint is the wrong shape for that. Falls back to the
 * pooled URL when the unpooled one is not present (local Postgres).
 */
function resolveConnectionString(): string {
  const url =
    process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? '';

  if (url === '') throw new Error('DATABASE_URL is not set.');

  return url;
}

/**
 * The trap this guards against is real and was hit while investigating: the
 * portal's own `.env.local` sets `DATABASE_URL` to a localhost database, and
 * loading it can shadow the production value injected by `vercel env run`.
 * A purge that silently ran against the wrong database would look like a
 * success. Refusing is the only safe response - never "carry on and hope".
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

async function main(): Promise<void> {
  console.log(
    apply
      ? '\nMode: APPLY - rows will be permanently deleted.\n'
      : '\nMode: DRY RUN - nothing will be written. Pass --apply to delete.\n',
  );

  // Resolved by identity and provider code, never by a hardcoded UUID: a
  // pasted id that has drifted would delete the wrong seller's connection.
  const [seller] = await sql<Row[]>`
    select id from seller_accounts
    where identity_id = ${SALS3_OFFICIAL_IDENTITY_ID}
  `;

  if (seller === undefined) {
    console.log(
      `No seller account with identity_id='${SALS3_OFFICIAL_IDENTITY_ID}'. Nothing to do.`,
    );
    return;
  }

  const [provider] = await sql<Row[]>`
    select id from supplier_providers where code = ${PROVIDER_CODE}
  `;

  if (provider === undefined) {
    console.log(`No '${PROVIDER_CODE}' provider row. Nothing to do.`);
    return;
  }

  const sellerId = seller.id as string;
  const providerId = provider.id as string;

  const [connection] = await sql<Row[]>`
    select id, display_name, status, external_account_masked,
           external_account_lookup_hash, created_at
    from supplier_connections
    where seller_account_id = ${sellerId} and provider_id = ${providerId}
  `;

  if (connection === undefined) {
    console.log(
      `Seller ${sellerId} holds no ${PROVIDER_CODE} connection. Nothing to do.`,
    );
    return;
  }

  const connectionId = connection.id as string;

  console.log('Target:');
  console.log(
    `  seller_account_id : ${sellerId} (${SALS3_OFFICIAL_IDENTITY_ID})`,
  );
  console.log(`  connection_id     : ${connectionId}`);
  console.log(`  display_name      : ${connection.display_name as string}`);
  console.log(`  status            : ${connection.status as string}`);
  console.log(
    `  external account  : ${connection.external_account_masked as string}`,
  );

  // Read every dependent row before touching anything: these same rows are
  // both the dry-run report and the backup file.
  const secrets = await sql<Row[]>`
    select * from supplier_connection_secrets where connection_id = ${connectionId}
  `;
  const candidates = await sql<Row[]>`
    select * from supplier_candidates where supplier_connection_id = ${connectionId}
  `;
  const candidateIds = candidates.map((c) => c.id as string);
  const snapshots =
    candidateIds.length === 0
      ? []
      : await sql<Row[]>`
          select * from supplier_snapshots where candidate_id in ${sql(candidateIds)}
        `;
  const evaluations =
    candidateIds.length === 0
      ? []
      : await sql<Row[]>`
          select * from candidate_evaluations where candidate_id in ${sql(candidateIds)}
        `;
  const bindings = await sql<Row[]>`
    select * from supplier_account_bindings
    where provider_id = ${providerId} and seller_account_id = ${sellerId}
  `;

  console.log('\nRows in scope:');
  console.log(`  supplier_connection_secrets : ${secrets.length}`);
  console.log(`  supplier_candidates         : ${candidates.length}`);
  console.log(`  supplier_snapshots          : ${snapshots.length} (cascade)`);
  console.log(
    `  candidate_evaluations       : ${evaluations.length} (cascade)`,
  );
  console.log(`  supplier_account_bindings   : ${bindings.length}`);
  console.log(`  supplier_connections        : 1`);

  if (!apply) {
    console.log('\nDry run complete. No changes were made.');
    return;
  }

  // Written before the transaction opens, so a backup always exists on disk
  // by the time the first DELETE runs. The secret is kept as stored
  // ciphertext - this script cannot decrypt it and has no reason to.
  const backupPath = `${process.cwd()}/purge-dev-user-cj-backup-${connectionId}.json`;

  writeFileSync(
    backupPath,
    JSON.stringify(
      {
        purgedAt: new Date().toISOString(),
        databaseHost: host,
        sellerAccountId: sellerId,
        providerId,
        connection,
        secrets,
        candidates,
        snapshots,
        evaluations,
        bindings,
      },
      null,
      2,
    ),
  );

  console.log(`\nBackup written: ${backupPath}`);

  const deleted = await sql.begin(async (tx) => {
    const secretsDeleted = await tx`
      delete from supplier_connection_secrets where connection_id = ${connectionId}
    `;
    // Cascades to supplier_snapshots and candidate_evaluations. Must precede
    // the connection delete: this FK is ON DELETE RESTRICT, so the connection
    // cannot go while a single candidate still points at it.
    const candidatesDeleted = await tx`
      delete from supplier_candidates where supplier_connection_id = ${connectionId}
    `;
    // The row that actually causes `cj_account_taken`. The connection alone
    // going away would not release the provider account.
    const bindingsDeleted = await tx`
      delete from supplier_account_bindings
      where provider_id = ${providerId} and seller_account_id = ${sellerId}
    `;
    const connectionsDeleted = await tx`
      delete from supplier_connections where id = ${connectionId}
    `;

    if (connectionsDeleted.count !== 1) {
      // Something raced us, or a dependency we did not know about held it.
      // Rolling back is the only honest outcome - a partial purge would
      // leave orphaned candidates and a freed binding pointing at nothing.
      throw new Error(
        `Expected to delete exactly 1 connection, deleted ${connectionsDeleted.count}. Rolling back.`,
      );
    }

    const counts = {
      secrets: secretsDeleted.count,
      candidates: candidatesDeleted.count,
      bindings: bindingsDeleted.count,
      connections: connectionsDeleted.count,
    };

    // The audit trail is the only record left that this happened - the rows
    // themselves are gone. Earlier `bootstrapped` and `bind_rejected` events
    // are deliberately left in place.
    await tx`
      insert into audit_events (actor_id, action, entity_type, entity_id, payload)
      values (
        ${ACTOR_ID},
        'supplier_connection.purged',
        'SupplierConnection',
        ${connectionId},
        ${tx.json({
          providerCode: PROVIDER_CODE,
          sellerAccountId: sellerId,
          identityId: SALS3_OFFICIAL_IDENTITY_ID,
          externalAccountMasked: connection.external_account_masked as string,
          deleted: counts,
          backupPath,
        })}
      )
    `;

    return counts;
  });

  console.log('\nDeleted:');
  console.log(`  supplier_connection_secrets : ${deleted.secrets}`);
  console.log(`  supplier_candidates         : ${deleted.candidates}`);
  console.log(`  supplier_account_bindings   : ${deleted.bindings}`);
  console.log(`  supplier_connections        : ${deleted.connections}`);
  console.log(
    `\nThe ${PROVIDER_CODE} account is released. Connect it at /supplier-apps under a real login.`,
  );
}

try {
  await main();
} finally {
  await sql.end();
}
