import {
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Supplier providers (ADR-008: curated Supplier Apps). Seed only
 * `CJ_DROPSHIPPING` - do not add a fake future provider. A future provider
 * needs a real adapter (`src/modules/suppliers/providers/<name>/`) and
 * owner approval before a row is added here.
 */

export const supplierProviderStatusEnum = pgEnum('supplier_provider_status', [
  'ACTIVE',
  'DISABLED',
]);

export const supplierProviders = pgTable(
  'supplier_providers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    displayName: text('display_name').notNull(),

    status: supplierProviderStatusEnum('status').notNull().default('ACTIVE'),

    capabilities: jsonb('capabilities')
      .$type<{
        catalog: boolean;
        inventory: boolean;
        productWebhooks: boolean;
        orderSubmission: boolean;
        orderWebhooks: boolean;
      }>()
      .notNull(),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex('supplier_providers_code_key').on(table.code)],
);

export type SupplierProviderRow = typeof supplierProviders.$inferSelect;
export type NewSupplierProviderRow = typeof supplierProviders.$inferInsert;
