import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { supplierConnections } from './supplier-connections';

/**
 * Encrypted supplier credentials. Never stored in `supplier_connections`
 * directly, and never exported through a client-facing module or public
 * API - only `src/lib/secrets/postgres-supplier-secret-store.ts` reads or
 * writes this table.
 */
export const supplierConnectionSecrets = pgTable(
  'supplier_connection_secrets',
  {
    // Exactly one encrypted credential bundle per connection.
    connectionId: uuid('connection_id')
      .primaryKey()
      .references(() => supplierConnections.id, { onDelete: 'cascade' }),

    ciphertextBase64: text('ciphertext_base64').notNull(),
    ivBase64: text('iv_base64').notNull(),
    authTagBase64: text('auth_tag_base64').notNull(),
    keyVersion: integer('key_version').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export type SupplierConnectionSecretRow =
  typeof supplierConnectionSecrets.$inferSelect;
export type NewSupplierConnectionSecretRow =
  typeof supplierConnectionSecrets.$inferInsert;
