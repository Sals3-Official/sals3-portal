import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { sellerAccounts } from './seller-accounts';

/**
 * A seller account's own, persisted operating-market configuration — the
 * real thing that replaces `lib/seller-center/market-config.ts`'s
 * illustrative PH/ID/SG fixture on the Market Rules screen.
 *
 * Deliberately narrow. This table records only what the platform has
 * actually authorized and the seller has explicitly been set up for: which
 * approved buyer destination, under which capability policy version, in
 * which lifecycle state, with who/why/when. It stores no carrier name, no
 * tax label, no payout rail or mask, no cutoff time and no payout
 * threshold. Those exist in the fixture as interface-review examples and
 * copying them here would turn illustration into a fabricated operational
 * contract — see ADR-015 §5 and `market-config.ts`'s own disclaimer.
 *
 * `sellingCurrencyCode`, `locale`, and `timeZone` are nullable for the same
 * reason: no per-destination selling currency, locale, or time zone is
 * platform-authorized yet (`modules/market-config/capabilities.ts` exposes
 * an empty `authorizedSellingCurrencyCodes`), so their honest value is
 * absent. A `NOT NULL` column would have forced a guess.
 *
 * Tenancy is the `seller_account_id` FK, and every repository query
 * constrains on it inside the statement rather than filtering afterwards.
 */

export const sellerMarketProfileStatusEnum = pgEnum(
  'seller_market_profile_status',
  ['DRAFT', 'ACTIVE', 'SUSPENDED'],
);

export type SellerMarketProfileStatus =
  (typeof sellerMarketProfileStatusEnum.enumValues)[number];

export const sellerMarketProfiles = pgTable(
  'seller_market_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    sellerAccountId: uuid('seller_account_id')
      .notNull()
      .references(() => sellerAccounts.id, { onDelete: 'restrict' }),

    /**
     * An approved buyer destination country code. Validated against
     * `modules/market-config/capabilities.ts` at the write boundary — the
     * database stores the outcome of that check, it does not re-implement
     * the allowlist as a Postgres enum that would then need a migration
     * every time the pilot changes.
     */
    destinationCountryCode: text('destination_country_code').notNull(),

    /** Only ever set to a currency the destination itself authorizes. */
    sellingCurrencyCode: text('selling_currency_code'),

    locale: text('locale'),
    timeZone: text('time_zone'),

    status: sellerMarketProfileStatusEnum('status').notNull().default('DRAFT'),

    /**
     * Incremented by every accepted mutation and used as the compare-and-set
     * token: an update states the version it read, so a stale tab or a
     * double submit loses the race instead of silently overwriting a change
     * it never saw.
     */
    version: integer('version').notNull().default(1),

    /**
     * Which `capabilities.ts` version authorized this row. Kept so a later
     * policy change is auditable against what was actually approved at
     * setup time, rather than being re-derived from today's policy.
     */
    capabilityVersion: text('capability_version').notNull(),
    source: text('source').notNull(),

    /** Required business justification for the most recent transition. */
    reason: text('reason').notNull(),
    actorId: text('actor_id').notNull(),

    activatedAt: timestamp('activated_at', { withTimezone: true }),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    /**
     * Deterministic "the profile for this seller + destination": at most one
     * row that is either being set up or live. A `SUSPENDED` row is excluded
     * so an account that was suspended can be set up again without first
     * deleting history, and the full timeline stays in `audit_events`.
     */
    uniqueIndex('seller_market_profiles_live_key')
      .on(table.sellerAccountId, table.destinationCountryCode)
      .where(sql`${table.status} in ('DRAFT', 'ACTIVE')`),
    index('seller_market_profiles_seller_idx').on(table.sellerAccountId),
  ],
);

export type SellerMarketProfileRow = typeof sellerMarketProfiles.$inferSelect;
export type NewSellerMarketProfileRow =
  typeof sellerMarketProfiles.$inferInsert;
