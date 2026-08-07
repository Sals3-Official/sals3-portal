import 'server-only';

import { drizzleAdapter } from '@better-auth/drizzle-adapter';
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

const auth = betterAuth({
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
    nextCookies(),
  ],
});

export default auth;
