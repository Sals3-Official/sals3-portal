import 'server-only';

import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { dash } from '@better-auth/infra';
import { betterAuth } from 'better-auth';
import { nextCookies } from 'better-auth/next-js';
import { twoFactor } from 'better-auth/plugins';
import getDb from '@/lib/db/client';
import {
  authAccounts,
  authRateLimits,
  authSessions,
  authTwoFactors,
  authUsers,
  authVerifications,
} from '@/lib/db/schema';
import { insertSellerAccountIfAbsent } from '@/modules/suppliers/repository';
import sendAuthEmail from './email';

const authSchema = {
  user: authUsers,
  session: authSessions,
  account: authAccounts,
  verification: authVerifications,
  twoFactor: authTwoFactors,
  rateLimit: authRateLimits,
};

/**
 * Builds the Better Auth instance. Kept behind {@link getAuth} because
 * `drizzleAdapter` needs a live `getDb()`, and `getDb()` throws without
 * `DATABASE_URL`. Next.js imports every route module during `next build`'s
 * "Collecting page data" phase, so building this at module evaluation made
 * the whole build fail in any environment without a database — CI, a Vercel
 * preview, a fresh clone. Importing this module must stay side-effect free;
 * only serving a request may require configuration.
 */
function createAuth() {
  return betterAuth({
    appName: 'Sals3 Seller Center',
    baseURL: process.env.BETTER_AUTH_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(getDb(), {
      provider: 'pg',
      schema: authSchema,
    }),
    user: {
      additionalFields: {
        portalRole: {
          type: 'string',
          required: false,
          defaultValue: 'seller_manager',
          input: false,
        },
        registrationBusinessModel: {
          type: 'string',
          required: false,
          returned: false,
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      autoSignIn: false,
      requireEmailVerification: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await sendAuthEmail({ to: user.email, url, kind: 'reset' });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      expiresIn: 60 * 60,
      sendVerificationEmail: async ({ user, url }) => {
        await sendAuthEmail({ to: user.email, url, kind: 'verify' });
      },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 60,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-up/email': { window: 300, max: 5 },
        '/request-password-reset': { window: 300, max: 3 },
        '/send-verification-email': { window: 300, max: 3 },
        '/two-factor/*': { window: 60, max: 5 },
      },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            if (
              user.registrationBusinessModel !== 'RETAILER' &&
              user.registrationBusinessModel !== 'DROPSHIPPER'
            ) {
              return;
            }

            await insertSellerAccountIfAbsent(getDb(), {
              identityId: user.id,
              businessModel: user.registrationBusinessModel,
              verificationState: 'PENDING',
              accountState: 'PENDING',
            });
          },
        },
      },
    },
    plugins: [
      twoFactor({
        issuer: 'Sals3 Seller Center',
        twoFactorTable: 'twoFactor',
        totpOptions: {
          digits: 6,
          period: 30,
        },
        backupCodeOptions: {
          amount: 10,
          length: 10,
        },
        accountLockout: {
          enabled: true,
          maxFailedAttempts: 5,
          durationSeconds: 15 * 60,
        },
      }),
      // Better Auth's hosted dashboard. Reads BETTER_AUTH_API_KEY from the
      // environment; without it the plugin logs a warning and stays inert, so
      // an environment with no key still boots. `activityTracking` is left off
      // deliberately: enabling it makes the plugin write `user.lastActiveAt`,
      // a column auth_users does not have, and the Drizzle adapter rejects an
      // unknown field outright.
      dash(),
      // Must stay last - Better Auth warns when the cookie plugin is not the
      // final entry, because later plugins would not see its cookie handling.
      nextCookies(),
    ],
  });
}

let authInstance: ReturnType<typeof createAuth> | undefined;

/**
 * Returns the Better Auth instance, building it on first use. Every caller
 * must go through this rather than holding a module-level instance, so that
 * importing an auth route never touches the database.
 */
export default function getAuth(): ReturnType<typeof createAuth> {
  authInstance ??= createAuth();

  return authInstance;
}
