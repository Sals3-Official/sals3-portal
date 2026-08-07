/* eslint-disable no-console -- CLI scripts should report their result. */
import { randomBytes } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
/* eslint-disable import/extensions -- tsx resolves extensionless project imports. */
import type { PortalRole } from '../src/lib/auth/permissions';
import { PORTAL_ROLES } from '../src/lib/auth/permissions';
import { authAccounts, authUsers } from '../src/lib/db/schema/auth';
import { sellerAccounts } from '../src/lib/db/schema/seller-accounts';
/* eslint-enable import/extensions */

/**
 * Provisions a portal login directly, skipping signup, email verification, and
 * owner approval.
 *
 * This exists for environments where email delivery is unconfigured or broken
 * and nobody can complete the normal flow. It is an owner-only tool run from a
 * shell that already holds DATABASE_URL, so it grants nothing the operator
 * could not do with raw SQL - but it does mint a working credential, so treat
 * every account it creates as temporary and delete it once the real signup
 * path works.
 *
 * The password is hashed with Better Auth's own `hashPassword`, so the row is
 * indistinguishable from one written by `signUpEmail` and `verifyPassword`
 * accepts it.
 */

try {
  process.loadEnvFile('.env.local');
} catch {
  // No .env.local - env vars must already be exported in the shell.
}

const PASSWORD_BYTES = 18;
const MIN_PASSWORD_LENGTH = 12;

type Args = {
  email: string;
  name: string;
  password: string;
  role: PortalRole;
  generated: boolean;
};

function isPortalRole(value: string | undefined): value is PortalRole {
  return PORTAL_ROLES.some((role) => role === value);
}

/** URL-safe, no ambiguous separators to fumble when retyping. */
function generatePassword(): string {
  return randomBytes(PASSWORD_BYTES).toString('base64url');
}

function parseArgs(argv: string[]): Args {
  let email: string | undefined;
  let name: string | undefined;
  let password: string | undefined;
  let role: PortalRole = 'seller_manager';

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    const next = argv[index + 1];

    if (value === '--email') {
      email = next;
      index += 1;
    } else if (value === '--name') {
      name = next;
      index += 1;
    } else if (value === '--password') {
      password = next;
      index += 1;
    } else if (value === '--role') {
      if (isPortalRole(next)) {
        role = next;
        index += 1;
      } else {
        throw new Error(`Unsupported role "${next}".`);
      }
    }
  }

  if (email === undefined || email.trim() === '') {
    throw new Error(
      'Usage: npm run create:portal-user -- --email user@example.com [--name "Full Name"] [--password ...] [--role seller_manager]',
    );
  }

  if (password !== undefined && password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters to satisfy emailAndPassword.minPasswordLength.`,
    );
  }

  const resolvedEmail = email.trim().toLowerCase();

  return {
    email: resolvedEmail,
    name:
      name?.trim() === undefined || name.trim() === ''
        ? resolvedEmail
        : name.trim(),
    password: password ?? generatePassword(),
    role,
    generated: password === undefined,
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
    const existing = await db
      .select()
      .from(authUsers)
      .where(eq(authUsers.email, args.email))
      .limit(1);

    if (existing[0] !== undefined) {
      throw new Error(
        `${args.email} already exists. Use \`npm run approve:portal-user -- --email ${args.email} --verify-email\` to unblock it instead of creating a duplicate.`,
      );
    }

    // Better Auth's own id shape: a 32-character alphanumeric string.
    const userId = randomBytes(24).toString('base64url').slice(0, 32);
    const accountId = randomBytes(24).toString('base64url').slice(0, 32);
    const now = new Date();

    await db.transaction(async (tx) => {
      await tx.insert(authUsers).values({
        id: userId,
        name: args.name,
        email: args.email,
        emailVerified: true,
        portalRole: args.role,
        createdAt: now,
        updatedAt: now,
      });

      await tx.insert(authAccounts).values({
        id: accountId,
        accountId: userId,
        providerId: 'credential',
        userId,
        password: await hashPassword(args.password),
        createdAt: now,
        updatedAt: now,
      });

      if (
        args.role === 'seller_manager' ||
        args.role === 'seller_staff' ||
        args.role === 'viewer'
      ) {
        await tx.insert(sellerAccounts).values({
          identityId: userId,
          businessModel: 'DROPSHIPPER',
          verificationState: 'VERIFIED',
          accountState: 'ACTIVE',
          createdAt: now,
          updatedAt: now,
        });
      }
    });

    console.log(`Created ${args.email} as ${args.role}, email pre-verified.`);

    if (args.generated) {
      console.log(`Password: ${args.password}`);
      console.log(
        'This password is shown once and is not recoverable - the stored hash is one-way.',
      );
    }

    console.log(
      'Temporary account. Delete it once the normal signup and email flow works.',
    );
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
