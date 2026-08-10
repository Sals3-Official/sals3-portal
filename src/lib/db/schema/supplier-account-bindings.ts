import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { sellerAccounts } from './seller-accounts';
import { supplierProviders } from './supplier-providers';

/**
 * Permanent provider-account ownership ledger (ADR-006/008).
 *
 * `supplier_connections` answers "what is this seller's configuration right
 * now"; this table answers "who owns this provider account, ever". The two
 * are not the same question, and only this one can be answered by a row that
 * still exists after a disconnect.
 *
 * APPEND-ONLY. No repository function updates or deletes a row here, and
 * none may be added. That is the whole mechanism: the unique index below is
 * only a permanent binding because the row is never released. The connection
 * table's own `(provider_id, external_account_lookup_hash)` unique index
 * cannot do this job - `reconnectConnection` rewrites that hash, so a seller
 * moving to a different provider account would free their old one for
 * somebody else to claim.
 *
 * A seller may hold several rows: switching to another CJ account of their
 * own adds a binding rather than replacing one, so returning to a previous
 * account later still reads back as theirs.
 */

export const SUPPLIER_ACCOUNT_BINDINGS_PROVIDER_HASH_KEY =
  'supplier_account_bindings_provider_hash_key';

export const supplierAccountBindings = pgTable(
  'supplier_account_bindings',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    providerId: uuid('provider_id')
      .notNull()
      .references(() => supplierProviders.id, { onDelete: 'restrict' }),

    // The same sha256(`${providerCode}:${openId}`) the connection row stores -
    // the provider account is never written here in displayable plaintext.
    externalAccountLookupHash: text('external_account_lookup_hash').notNull(),

    sellerAccountId: uuid('seller_account_id')
      .notNull()
      .references(() => sellerAccounts.id, { onDelete: 'restrict' }),

    firstBoundAt: timestamp('first_bound_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex(SUPPLIER_ACCOUNT_BINDINGS_PROVIDER_HASH_KEY).on(
      table.providerId,
      table.externalAccountLookupHash,
    ),
    index('supplier_account_bindings_seller_idx').on(table.sellerAccountId),
  ],
);

export type SupplierAccountBindingRow =
  typeof supplierAccountBindings.$inferSelect;
export type NewSupplierAccountBindingRow =
  typeof supplierAccountBindings.$inferInsert;
