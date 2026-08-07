import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Seller accounts (ADR-006: separate Retailer/Dropshipper registration,
 * one immutable business model per account).
 *
 * There is no mutation anywhere in this codebase that changes
 * `businessModel` after creation - a business-model change requires a new
 * account/registration, not an UPDATE. Enforced by omission: no repository
 * function accepts it as a settable field.
 */

export const sellerBusinessModelEnum = pgEnum('seller_business_model', [
  'RETAILER',
  'DROPSHIPPER',
]);

export const sellerVerificationStateEnum = pgEnum('seller_verification_state', [
  'PENDING',
  'VERIFIED',
  'REJECTED',
]);

export const sellerAccountStateEnum = pgEnum('seller_account_state', [
  'PENDING',
  'ACTIVE',
  'SUSPENDED',
  'CLOSED',
]);

export const sellerAccounts = pgTable(
  'seller_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Server-verified identity-provider subject/UID. No real identity
    // provider exists yet for the portal - see src/lib/auth/seller-guard.ts.
    identityId: text('identity_id').notNull(),

    businessModel: sellerBusinessModelEnum('business_model').notNull(),

    verificationState: sellerVerificationStateEnum('verification_state')
      .notNull()
      .default('PENDING'),

    accountState: sellerAccountStateEnum('account_state')
      .notNull()
      .default('PENDING'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('seller_accounts_identity_id_key').on(table.identityId),
    index('seller_accounts_business_model_idx').on(table.businessModel),
    index('seller_accounts_account_state_idx').on(table.accountState),
  ],
);

export type SellerAccountRow = typeof sellerAccounts.$inferSelect;
export type NewSellerAccountRow = typeof sellerAccounts.$inferInsert;
