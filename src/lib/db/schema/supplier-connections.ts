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

/**
 * Exported because `connectCjSupplier` maps a Postgres 23505 back to a
 * specific user-facing reason by constraint name. A literal repeated in that
 * file would drift silently on a rename and the mapping would quietly
 * degrade to a generic failure - an invariant that fails open.
 */
export const SUPPLIER_CONNECTIONS_SELLER_PROVIDER_KEY =
  'supplier_connections_seller_provider_key';
export const SUPPLIER_CONNECTIONS_PROVIDER_EXTERNAL_HASH_KEY =
  'supplier_connections_provider_external_hash_key';

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
    uniqueIndex(SUPPLIER_CONNECTIONS_SELLER_PROVIDER_KEY).on(
      table.sellerAccountId,
      table.providerId,
    ),
    // At most one *live* connection per provider account. Permanent ownership
    // is a different guarantee and lives in `supplier_account_bindings` -
    // this index cannot provide it, because the hash it constrains is
    // rewritten whenever a seller reconnects with a different account.
    // Must stay unconditional: a partial index (e.g. excluding DISCONNECTED)
    // is exactly the weakening `supplier-connections.test.ts` guards against.
    uniqueIndex(SUPPLIER_CONNECTIONS_PROVIDER_EXTERNAL_HASH_KEY).on(
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
