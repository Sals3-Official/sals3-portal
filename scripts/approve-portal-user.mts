/* eslint-disable no-console -- CLI scripts should report their result. */
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
/* eslint-disable import/extensions -- tsx resolves extensionless project imports. */
import type { PortalRole } from '../src/lib/auth/permissions';
import { PORTAL_ROLES } from '../src/lib/auth/permissions';
import { authUsers } from '../src/lib/db/schema/auth';
import { sellerAccounts } from '../src/lib/db/schema/seller-accounts';
/* eslint-enable import/extensions */

try {
  process.loadEnvFile('.env.local');
} catch {
  // No .env.local - env vars must already be exported in the shell.
}

type Args = {
  email: string;
  role: PortalRole;
  verifyEmail: boolean;
};

function isPortalRole(value: string | undefined): value is PortalRole {
  return PORTAL_ROLES.some((role) => role === value);
}

function parseArgs(argv: string[]): Args {
  let email: string | undefined;
  let role: PortalRole = 'seller_manager';
  let verifyEmail = false;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    const next = argv[index + 1];

    if (value === '--email') {
      email = next;
      index += 1;
    } else if (value === '--role') {
      if (isPortalRole(next)) {
        role = next;
        index += 1;
      } else {
        throw new Error(`Unsupported role "${next}".`);
      }
    } else if (value === '--verify-email') {
      verifyEmail = true;
    }
  }

  if (email === undefined || email.trim() === '') {
    throw new Error(
      'Usage: npm run approve:portal-user -- --email user@example.com [--role seller_manager] [--verify-email]',
    );
  }

  return {
    email: email.trim().toLowerCase(),
    role,
    verifyEmail,
  };
}

async function main() {
  const connectionString = process.env.DATABASE_URL;

  if (connectionString === undefined || connectionString === '') {
    throw new Error('DATABASE_URL is not set.');
  }

  const args = parseArgs(process.argv.slice(2));
  const sql = postgres(connectionString, { max: 1 });
  const db = drizzle(sql);

  try {
    const users = await db
      .select()
      .from(authUsers)
      .where(eq(authUsers.email, args.email))
      .limit(1);

    const user = users[0];

    if (user === undefined) {
      throw new Error(`No auth user exists for ${args.email}.`);
    }

    await db
      .update(authUsers)
      .set({
        portalRole: args.role,
        // `--verify-email` marks the address verified without the user ever
        // clicking a link. It exists because email delivery is a separate
        // system that can be down or unconfigured while the portal itself is
        // fine, and `requireEmailVerification` otherwise locks out every
        // account in that window. It is an owner-only override run from a
        // shell that already holds DATABASE_URL, so it grants nothing the
        // operator could not do with SQL - but it does skip a real check, so
        // it stays opt-in and is never implied by approval alone.
        ...(args.verifyEmail ? { emailVerified: true } : {}),
        updatedAt: new Date(),
      })
      .where(eq(authUsers.id, user.id));

    if (
      args.role === 'seller_manager' ||
      args.role === 'seller_staff' ||
      args.role === 'viewer'
    ) {
      const updated = await db
        .update(sellerAccounts)
        .set({
          accountState: 'ACTIVE',
          verificationState: 'VERIFIED',
          updatedAt: new Date(),
        })
        .where(eq(sellerAccounts.identityId, user.id))
        .returning();

      if (updated[0] === undefined) {
        throw new Error(
          `No seller application exists for ${args.email}; cannot approve seller access.`,
        );
      }
    }

    console.log(
      `Approved ${args.email} as ${args.role}${
        args.verifyEmail ? ' and marked the email verified' : ''
      }.`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
