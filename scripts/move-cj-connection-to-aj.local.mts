/* eslint-disable no-console -- CLI script; status output is its job. */
/**
 * LOCAL-ONLY data fix (owner request 2026-08-13): move the existing CJ
 * connection, its permanent account binding, and therefore the stored
 * encrypted credential to aj@anythingsupplies.com's seller account, so the
 * live All Supplier Products browse works when signed in as AJ locally.
 *
 * Refuses to run when NODE_ENV=production or when DATABASE_URL is not
 * localhost - this must never touch prod, where the binding permanence rule
 * stands.
 *
 * Delete this script after use if you like; it is idempotent either way.
 */
import postgres from 'postgres';

try {
  process.loadEnvFile('.env.local');
} catch {
  // env must already be exported
}

const AJ_EMAIL = 'aj@anythingsupplies.com';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run in production.');
  }

  const url = process.env.DATABASE_URL;

  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL is not set.');
  }

  if (!/localhost|127\.0\.0\.1/.test(url)) {
    throw new Error('Refusing: DATABASE_URL is not a localhost database.');
  }

  const sql = postgres(url, { max: 1 });

  try {
    const users = await sql`
      select id from auth_users where email = ${AJ_EMAIL}
    `;
    const identityId = users[0]?.id as string | undefined;

    if (identityId === undefined) {
      throw new Error(`No auth user exists for ${AJ_EMAIL}.`);
    }

    const sellers = await sql`
      select id from seller_accounts where identity_id = ${identityId}
    `;
    const ajSellerId = sellers[0]?.id as string | undefined;

    if (ajSellerId === undefined) {
      throw new Error(`No seller account exists for ${AJ_EMAIL}.`);
    }

    await sql.begin(async (tx) => {
      const connections = await tx`
        update supplier_connections
        set seller_account_id = ${ajSellerId}
        where external_account_masked = 'CJ...8305'
        returning id, status
      `;

      if (connections.length === 0) {
        throw new Error('No CJ...8305 connection found to move.');
      }

      const bindings = await tx`
        update supplier_account_bindings
        set seller_account_id = ${ajSellerId}
        returning seller_account_id
      `;

      console.log(
        `moved connection ${connections[0]!.id as string} (${connections[0]!.status as string}) and ${bindings.length} binding(s) to ${AJ_EMAIL} seller ${ajSellerId}`,
      );
    });
  } finally {
    await sql.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(
      '[move-cj] Failed:',
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  });
