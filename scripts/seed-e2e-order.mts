import postgres from 'postgres';

/**
 * Seeds one accepted order so the orders e2e can exercise a real parcel.
 *
 * ## Why this exists
 *
 * `e2e/seller-center-orders.spec.ts` branches on which of four states the
 * environment reaches, and skips the parcel-dependent tests with a named
 * reason when there is nothing to open. Without a seeded order that is *every*
 * run, so the lane chips, the disclosure banner, the reprint panel and the two
 * money rails have no coverage at all — the spec's own header says so.
 *
 * Giving it one real parcel un-skips them. No spec change is needed: the spec
 * was written environment-aware precisely so this would be the only missing
 * piece.
 *
 * ## Why it is not `npm run db:migrate` against a developer's database
 *
 * It is not run there. This is for an ephemeral CI Postgres and a throwaway
 * local database only, and it writes rows, never DDL. The standing rule that
 * production DDL arrives solely through the break-glass workflow is untouched:
 * nothing here can be mistaken for evidence that production has a column,
 * because nothing here creates one.
 *
 * ## Idempotent on purpose
 *
 * `on conflict do nothing` throughout, so re-running against a database that
 * already holds the seed is a no-op rather than a duplicate-key crash. A
 * seeding script that only works once is a script that fails the second time
 * CI retries a job.
 */

const IDENTITY_ID = 'dev-user';

const SELLER_ID = 'e2e5eed0-0000-4000-8000-000000000001';
const PROVIDER_ID = 'e2e5eed0-0000-4000-8000-000000000002';
const CONNECTION_ID = 'e2e5eed0-0000-4000-8000-000000000003';
const INTENT_ID = 'e2e5eed0-0000-4000-8000-000000000004';
const ORDER_ID = 'e2e5eed0-0000-4000-8000-000000000005';
const GROUP_ID = 'e2e5eed0-0000-4000-8000-000000000006';
const PRODUCT_ID = 'e2e5eed0-0000-4000-8000-000000000007';
const VARIANT_ID = 'e2e5eed0-0000-4000-8000-000000000008';

const ADDRESS = {
  email: 'e2e-buyer@example.test',
  fullName: 'Rodrigo Santos',
  phone: '+639171234567',
  addressLine1: '12 Mabini Street',
  city: 'Quezon City',
  region: 'Metro Manila',
  postalCode: '1100',
  country: 'PH',
};

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;

  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL is not set.');
  }

  // Refuses anything that is not a local or CI database. This script writes
  // rows into an orders table; pointing it at production by a stray env var
  // would put fabricated orders in front of a real seller.
  if (!/@(localhost|127\.0\.0\.1|postgres)[:/]/.test(url)) {
    throw new Error(
      'seed-e2e-order refuses a non-local DATABASE_URL. It is for ephemeral CI and throwaway local databases only.',
    );
  }

  const sql = postgres(url, { max: 1 });

  try {
    await sql`insert into seller_accounts (id, identity_id, business_model, verification_state, account_state)
      values (${SELLER_ID}, ${IDENTITY_ID}, 'DROPSHIPPER', 'VERIFIED', 'ACTIVE')
      on conflict do nothing`;

    await sql`insert into supplier_providers (id, code, display_name, capabilities)
      values (${PROVIDER_ID}, 'CJ_DROPSHIPPING', 'CJ Dropshipping', '{}'::jsonb)
      on conflict do nothing`;

    await sql`insert into supplier_connections
      (id, seller_account_id, provider_id, display_name, external_account_lookup_hash, external_account_masked, status)
      values (${CONNECTION_ID}, ${SELLER_ID}, ${PROVIDER_ID}, 'CJ · Main', 'e2e-hash', '****', 'CONNECTED')
      on conflict do nothing`;

    await sql`insert into checkout_intents
      (id, status, buyer_email, amount_minor, currency, cart_snapshot, address_snapshot, freight_snapshot, shipping_selection_snapshot)
      values (
        ${INTENT_ID}, 'ACCEPTED', ${ADDRESS.email}, 8277, 'USD', '{}'::jsonb,
        ${sql.json(ADDRESS)}, '{}'::jsonb,
        ${sql.json({ packageSelections: [{ packageId: 'pkg_1', arrivalTime: '12-50' }] })}
      )
      on conflict do nothing`;

    await sql`insert into sals3_orders
      (id, order_number, checkout_intent_id, stripe_checkout_session_id, payment_status, buyer_email, amount_minor, currency)
      values (${ORDER_ID}, 'S3-E2E-0000000001', ${INTENT_ID}, 'cs_e2e_seed', 'PAID', ${ADDRESS.email}, 8277, 'USD')
      on conflict do nothing`;

    await sql`insert into fulfillment_groups
      (id, order_id, package_id, shipping_tier, supplier_connection_id, origin_country, destination_country,
       logistic_name, option_id, channel_id, shipping_amount_minor, currency, status, cj_order_id, parcel_state, tracking_number)
      values (
        ${GROUP_ID}, ${ORDER_ID}, 'pkg_1', 'Standard', ${CONNECTION_ID}, 'CN', 'PH',
        'CJPacket Ordinary', 'opt-e2e', 'chan-e2e', 487, 'USD', 'CJ_PAID',
        'CJ-E2E-0001', 'FULFILLING', null
      )
      on conflict do nothing`;

    await sql`insert into sals3_order_lines
      (order_id, fulfillment_group_id, store_line_item_id, product_id, variant_id, title, quantity,
       unit_amount_minor, currency, supplier_connection_id, external_product_id, external_variant_id,
       sals3_sku, variant_label, image_url)
      values (
        ${ORDER_ID}, ${GROUP_ID}, 'li_e2e_1', ${PRODUCT_ID}, ${VARIANT_ID},
        'Outdoor Sports Cold-proof Face And Warm Mask', 1, 7790, 'USD', ${CONNECTION_ID},
        'cj-e2e-product', 'cj-e2e-variant', 'S3V-E2E0000001', 'Black',
        'https://cf.cjdropshipping.com/quick/product/e2e-seed.jpg'
      )
      on conflict do nothing`;

    // eslint-disable-next-line no-console -- this is a script; its output is the point.
    console.log('[seed-e2e-order] one accepted order is present');
  } finally {
    await sql.end();
  }
}

await main();
