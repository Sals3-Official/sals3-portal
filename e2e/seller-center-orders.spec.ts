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
 * **No environment this suite runs in can show a parcel.** On a developer's
 * machine the database has no order tables — they arrive through a break-glass
 * migration run rather than a deploy, and the standing rule is never to migrate
 * a local database. In CI it is starker still: the Verify workflow sets no
 * `DATABASE_URL` at all, so the page renders its "no database configured"
 * notice. Tests that need parcels therefore cannot run anywhere today, and the
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

const NO_DATABASE = 'No database configured in this environment';
const NOT_MIGRATED = 'The order tables are not in this database yet';

type OrdersState = 'no-database' | 'not-migrated' | 'empty' | 'parcels';

/**
 * Which of the four legible states this environment is showing.
 *
 * **Four, not three.** The first version of this helper modelled only
 * `not-migrated`, `empty` and `parcels`, and CI has none of them: the Verify
 * workflow runs with no `DATABASE_URL` at all — no postgres service, no env
 * block — so the page renders its "no database configured" notice, which the
 * helper silently classified as `empty`. Two tests then asserted copy that
 * state never shows. Green here, red in CI, and the spec's own header warned
 * against exactly this.
 *
 * The lesson is narrower than "add a state": a helper that classifies by
 * elimination will misfile every state it has not been told about, and the
 * misfiling is silent. Each state is now matched by its own marker, and
 * `empty` is the only fallthrough because it is the only one defined by the
 * absence of everything else.
 *
 * Waits for the heading before reading anything. `isVisible()` does not
 * auto-wait, so probing straight after `goto` is a race — and it lost exactly
 * once here, sending a test down the wrong branch while the page was correct.
 * The heading is server-rendered in every state, so it is the honest barrier.
 */
async function readOrdersState(page: Page): Promise<OrdersState> {
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();

  if ((await page.getByText(NO_DATABASE).count()) > 0) return 'no-database';
  if ((await page.getByText(NOT_MIGRATED).count()) > 0) return 'not-migrated';

  return (await page.getByRole('article').count()) > 0 ? 'parcels' : 'empty';
}

/**
 * Whether the workspace and its side panels rendered at all.
 *
 * `no-database` and `not-migrated` both replace the whole page with a notice,
 * so anything asserting a control, a chip or a panel has to gate on this
 * rather than on one of the two states by name.
 */
function rendersList(state: OrdersState): boolean {
  return state === 'parcels' || state === 'empty';
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
   * Whatever state this is, the page must say which one, and none of the three
   * "no rows" states may read as "you have made no sales".
   *
   * They render almost identically on a screen that only knows how to show
   * emptiness, and only one of them means the seller genuinely has no orders.
   * The other two mean *we cannot tell you* — a missing database, or tables the
   * break-glass run has not created — and reading either as an empty order book
   * is what sends somebody hunting for sales that were never lost.
   *
   * Every branch asserts real copy, so this test proves something in all four
   * environments rather than passing vacuously in three of them.
   */
  test('every state says which one it is, and none reads as an empty order book', async ({
    page,
  }) => {
    await page.goto('/orders');

    const state = await readOrdersState(page);

    if (state === 'no-database') {
      await expect(
        page.getByText(/DATABASE_URL is not set here/i),
      ).toBeVisible();

      return;
    }

    if (state === 'not-migrated') {
      await expect(
        page.getByText(/not the same as having no orders/i),
      ).toBeVisible();

      return;
    }

    if (state === 'empty') {
      // Tables exist and the account genuinely has none. The only one of the
      // three that really is an empty order book.
      await expect(page.getByText('No parcels match this view.')).toBeVisible();

      return;
    }

    await expect(page.getByRole('article').first()).toBeVisible();
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

    // The panel ships with the list, so both "cannot read" states replace it
    // with a notice rather than rendering it empty. Skipping on `not-migrated`
    // alone is what broke this test in CI, where the state is `no-database`.
    if (!rendersList(await readOrdersState(page))) {
      test.skip(true, 'This environment cannot render the orders list.');

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
