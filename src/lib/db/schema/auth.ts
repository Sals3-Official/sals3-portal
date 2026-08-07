import {
  boolean,
  bigint,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { PORTAL_ROLES } from '../../auth/permissions';
import { sellerBusinessModelEnum } from './seller-accounts';

export const portalRoleEnum = pgEnum('portal_role', PORTAL_ROLES);

export const authUsers = pgTable(
  'auth_users',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    portalRole: portalRoleEnum('portal_role')
      .notNull()
      .default('seller_manager'),
    registrationBusinessModel: sellerBusinessModelEnum(
      'registration_business_model',
    ),
    twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('auth_users_email_key').on(table.email),
    index('auth_users_portal_role_idx').on(table.portalRole),
  ],
);

export const authSessions = pgTable(
  'auth_sessions',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
  },
  (table) => [
    uniqueIndex('auth_sessions_token_key').on(table.token),
    index('auth_sessions_user_id_idx').on(table.userId),
  ],
);

export const authAccounts = pgTable(
  'auth_accounts',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', {
      withTimezone: true,
    }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('auth_accounts_user_id_idx').on(table.userId),
    uniqueIndex('auth_accounts_provider_account_key').on(
      table.providerId,
      table.accountId,
    ),
  ],
);

export const authVerifications = pgTable(
  'auth_verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('auth_verifications_identifier_idx').on(table.identifier)],
);

export const authTwoFactors = pgTable(
  'auth_two_factors',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    secret: text('secret').notNull(),
    backupCodes: text('backup_codes').notNull(),
    verified: boolean('verified').notNull().default(false),
    failedVerificationCount: integer('failed_verification_count')
      .notNull()
      .default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
  },
  (table) => [uniqueIndex('auth_two_factors_user_id_key').on(table.userId)],
);

export const authRateLimits = pgTable(
  'auth_rate_limits',
  {
    id: text('id').primaryKey(),
    key: text('key').notNull(),
    count: integer('count').notNull(),
    lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
  },
  (table) => [
    uniqueIndex('auth_rate_limits_key_key').on(table.key),
    index('auth_rate_limits_last_request_idx').on(table.lastRequest),
  ],
);

export type AuthUserRow = typeof authUsers.$inferSelect;
