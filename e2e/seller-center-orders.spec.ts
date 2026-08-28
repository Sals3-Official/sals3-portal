import { expect, test, type Page } from '@playwright/test';

/**
 * Seller Center orders.
 *
 * ## What changed, and what it cost
 *
 * This suite used to drive a fixture: it named parcels `A-88214` and
 * `A-88217`, checked an own-stock row's print checkbox, and read a settlement
 * statement full of illustrative money. All of that came from
 * `lib/seller-center/mock-data/orders.ts`, which is gone — the screen now
 * reads `sals3_orders` / `sals3_order_lines` / `fulfillment_groups`.
 *
 * **The Playwright database has no order tables.** They arrive through a
 * break-glass migration run rather than a deploy, and the standing rule is
 * never to migrate a local database, so `/orders` here renders its
 * not-migrated notice. Tests that need parcels therefore cannot run, and the
 * coverage they gave — lane counts, chip filters, the two money rails, the
 * blocked-action reasons — is genuinely lost until this suite has a database
 * with those tables and a seeded order.
 *
 * That is written down rather than papered over. The trap this file avoids is
 * the one part 72 fell into: a test that passes by asserting its own
 * environment. A spec reading "if there are no parcels, pass" would be green
 * forever while proving nothing, so parcel-dependent tests **skip with a named
 * reason** instead, and the state the environment *does* reach is asserted
 * properly below.
 *
 * Restoring the lost coverage needs two things, in this order: the order
 * tables in the Playwright database, and a seeded accepted order owned by the
 * bypass session's seller account.
 */

const NOT_MIGRATED = 'The order tables are not in this database yet';

type OrdersState = 'not-migrated' | 'empty' | 'parcels';

/**
 * Which of the three legible states this environment is showing.
 *
 * Waits for the heading before reading anything. `isVisible()` does not
 * auto-wait, so probing straight after `goto` is a race — and it lost exactly
 * once here, sending a test down the wrong branch while the page was correct.
 * The heading is server-rendered in every state, so it is the honest barrier.
 */
async function readOrdersState(page: Page): Promise<OrdersState> {
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();

  if ((await page.getByText(NOT_MIGRATED).count()) > 0) return 'not-migrated';

  return (await page.getByRole('article').count()) > 0 ? 'parcels' : 'empty';
}

test.describe('Seller Center orders', () => {
  /**
   * The load-bearing assertion of this file today.
   *
   * Whatever state the environment is in, `/orders` must answer with a page a
   * seller can read — not a Next error overlay. A missing table throws by
   * design (`readOrUnavailable` rethrows `undefined_table` so real schema
   * drift stays loud), so the screen has to catch that case itself, and this
   * is what proves it does.
   */
  test('renders a legible state rather than an error', async ({ page }) => {
    const response = await page.goto('/orders');

    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
    await expect(page.locator('text=/Unhandled Runtime Error/i')).toHaveCount(
      0,
    );
  });

  /**
   * A migration gap must not read as "you have made no sales".
   *
   * Those two states look identical on a screen that only knows how to render
   * emptiness, and only one of them should send somebody looking for lost
   * orders. The copy is asserted because it is the whole point of the check.
   */
  test('an absent order table says so instead of showing an empty order book', async ({
    page,
  }) => {
    await page.goto('/orders');

    const state = await readOrdersState(page);

    if (state === 'parcels') {
      test.skip(true, 'This environment has order tables and parcels.');

      return;
    }

    if (state === 'not-migrated') {
      await expect(
        page.getByText(/not the same as having no orders/i),
      ).toBeVisible();

      return;
    }

    // Tables exist and the account genuinely has none. Also a legible state,
    // and distinct from the one above.
    await expect(page.getByText('No parcels match this view.')).toBeVisible();
  });

  test('an unrecognised lane falls back rather than erroring', async ({
    page,
  }) => {
    const response = await page.goto('/orders?lane=not-a-lane');

    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
  });

  test('an unknown parcel answers 404, not a 404 page under a 200', async ({
    page,
  }) => {
    const response = await page.goto('/orders/does-not-exist');

    expect(response?.status()).toBe(404);
  });

  /**
   * The banner is a compliance surface: it is the only place telling a seller
   * which figures on this screen are real. It must not go back to calling
   * every parcel illustrative, and it must keep naming the unconfigured half.
   */
  test('the disclosure names what is unconfigured without calling orders samples', async ({
    page,
  }) => {
    await page.goto('/orders');

    if ((await readOrdersState(page)) !== 'parcels') {
      test.skip(
        true,
        'No order tables in this database; the banner needs the loaded list.',
      );

      return;
    }

    await expect(page.getByText(/real accepted orders/i)).toBeVisible();
    await expect(page.getByText(/not configured yet/i)).toBeVisible();
  });

  test('reprint history offers no fabricated entries', async ({ page }) => {
    await page.goto('/orders');

    if ((await readOrdersState(page)) === 'not-migrated') {
      test.skip(true, 'No order tables in this database.');

      return;
    }

    await expect(
      page.getByText('No labels have been printed.', { exact: false }),
    ).toBeVisible();
  });

  test('the lane tabs are present in every state that lists parcels', async ({
    page,
  }) => {
    await page.goto('/orders');

    if ((await readOrdersState(page)) !== 'parcels') {
      test.skip(true, 'No parcels in this environment to lane.');

      return;
    }

    await expect(page.getByRole('link', { name: /^All/ })).toBeVisible();
    await expect(page.getByText('Route', { exact: true })).toBeVisible();
  });

  /**
   * ADR-008 keeps Sals3 settlement and the seller's supplier spend on separate
   * rails, and the detail view is where that separation is visible.
   */
  test('the detail view separates the two money rails', async ({ page }) => {
    await page.goto('/orders');

    if ((await readOrdersState(page)) !== 'parcels') {
      test.skip(true, 'No parcels in this environment to open.');

      return;
    }

    await page
      .getByRole('article')
      .first()
      .getByRole('button', { name: 'Check details' })
      .click();

    await expect(
      page.getByRole('heading', { name: 'Sals3 settlement' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Your supplier spend' }),
    ).toBeVisible();
  });
});
