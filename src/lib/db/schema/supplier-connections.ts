import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { sellerAccounts } from './seller-accounts';
import { supplierProviders } from './supplier-providers';

/**
 * Supplier connections (ADR-008): one seller's own credentialed link to one
 * provider. The credential itself never lives here - see
 * `supplier-secrets.ts`. `externalAccountLookupHash`/`externalAccountMasked`
 * let the UI and uniqueness checks work without ever storing the CJ openId
 * in displayable plaintext, since it doubles as webhook signing material.
 */

export const supplierConnectionStatusEnum = pgEnum(
  'supplier_connection_status',
  [
    'PENDING',
    'CONNECTED',
    'DEGRADED',
    'REAUTH_REQUIRED',
    'DISCONNECTED',
    'REVOKED',
  ],
);

export const supplierConnections = pgTable(
  'supplier_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    sellerAccountId: uuid('seller_account_id')
      .notNull()
      .references(() => sellerAccounts.id, { onDelete: 'restrict' }),

    providerId: uuid('provider_id')
      .notNull()
      .references(() => supplierProviders.id, { onDelete: 'restrict' }),

    displayName: text('display_name').notNull(),

    externalAccountLookupHash: text('external_account_lookup_hash').notNull(),
    externalAccountMasked: text('external_account_masked').notNull(),

    status: supplierConnectionStatusEnum('status').notNull().default('PENDING'),

    accessTokenExpiresAt: timestamp('access_token_expires_at', {
      withTimezone: true,
    }),

    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', {
      withTimezone: true,
    }),

    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),

    lastErrorCode: text('last_error_code'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),

    disconnectedAt: timestamp('disconnected_at', { withTimezone: true }),
  },
  (table) => [
    // Phase 1: one account per provider for each Dropshipper.
    uniqueIndex('supplier_connections_seller_provider_key').on(
      table.sellerAccountId,
      table.providerId,
    ),
    uniqueIndex('supplier_connections_provider_external_hash_key').on(
      table.providerId,
      table.externalAccountLookupHash,
    ),
    index('supplier_connections_seller_status_idx').on(
      table.sellerAccountId,
      table.status,
    ),
  ],
);

export type SupplierConnectionRow = typeof supplierConnections.$inferSelect;
export type NewSupplierConnectionRow = typeof supplierConnections.$inferInsert;
