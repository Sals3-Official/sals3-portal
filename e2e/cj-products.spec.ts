import { expect, test, type Page } from '@playwright/test';

/**
 * All Supplier Products - the live CJ catalogue browser (owner decision
 * 2026-08-13).
 *
 * The table is a live `/product/list` read through the signed-in seller's own
 * CJ connection, so which products exist depends entirely on the environment:
 * CI and local runs typically have no CJ connection at all, and must render
 * the honest no-connection notice BEFORE any supplier call. These tests
 * therefore assert what the portal itself controls - the labelling, the URL
 * contract, the views - and never that a particular supplier product is
 * present. No test here depends on live CJ answering.
 */

/**
 * Either the live workspace rendered, or the environment honestly reported
 * why it could not: no database, no CJ connection, a connection needing
 * re-authentication, CJ throttling/unavailable, or the local browse throttle.
 * Never neither, and never a silent crash.
 *
 * The views nav is the "loaded" marker because every failure state returns
 * before it renders - the error notice is the whole output in those cases.
 */
async function expectLoadedOrReported(page: Page): Promise<void> {
  const views = page.getByRole('navigation', { name: 'Saved views' });
  const reported = page.getByRole('heading', {
    name: /No database configured in this environment|No CJ connection yet|Your CJ connection needs attention|CJ is limiting requests right now|Browsing too fast|CJ did not answer/,
  });

  await expect(views.or(reported).first()).toBeVisible({
    timeout: 30_000,
  });
}

test.describe('All Supplier Products', () => {
  test('renders the live catalogue browser at /products', async ({ page }) => {
    await page.goto('/products');

    await expectLoadedOrReported(page);
    await expect(
      page.getByRole('heading', { name: 'All Supplier Products' }),
    ).toBeVisible();
  });

  test('still renders for a retired ?signal / ?source=cj / ?cjPage link', async ({
    page,
  }) => {
    await page.goto(
      '/products?signal=CJ_TRENDING&source=cj&cjPage=99999999&cjSearch=x',
    );

    await expectLoadedOrReported(page);
  });

  test('states in the page header that the catalogue is live', async ({
    page,
  }) => {
    await page.goto('/products');
    await expectLoadedOrReported(page);

    // The in-table banner was removed by owner request; the page header still
    // has to say plainly that this is a live supplier read, not saved data.
    await expect(
      page.getByText('The live CJdropshipping catalogue', { exact: false }),
    ).toBeVisible();
  });

  test('shows only the live product columns', async ({ page }) => {
    await page.goto('/products');
    await expectLoadedOrReported(page);

    const table = page.getByRole('table');

    if (!(await table.isVisible())) return;

    await expect(
      table.getByRole('columnheader', { name: 'Product' }),
    ).toBeVisible();
    await expect(
      table.getByRole('columnheader', { name: 'Category' }),
    ).toBeVisible();
    await expect(
      table.getByRole('columnheader', { name: 'Supplier price' }),
    ).toBeVisible();
    // Pipeline overlay columns are hidden for now.
    await expect(table.getByRole('columnheader')).toHaveCount(3);
  });

  test('offers exactly the three live views under the page title', async ({
    page,
  }) => {
    await page.goto('/products');
    await expectLoadedOrReported(page);

    const views = page.getByRole('navigation', { name: 'Saved views' });

    if (await views.isVisible()) {
      await expect(
        views.getByRole('link', { name: 'All products' }),
      ).toBeVisible();
      await expect(
        views.getByRole('link', { name: 'Most listed' }),
      ).toBeVisible();
      await expect(
        views.getByRole('link', { name: 'New arrivals' }),
      ).toBeVisible();
      // Retired saved-data views must be gone.
      await expect(views.getByRole('link')).toHaveCount(3);
    }
  });

  test('keeps the active view in a shareable URL and degrades retired views to All', async ({
    page,
  }) => {
    await page.goto('/products?view=most-listed');
    await expectLoadedOrReported(page);

    const views = page.getByRole('navigation', { name: 'Saved views' });

    if (await views.isVisible()) {
      await expect(
        views.getByRole('link', { name: 'Most listed' }),
      ).toHaveAttribute('aria-current', 'page');
    }

    await page.goto('/products?view=needs-attention');
    await expectLoadedOrReported(page);

    if (await views.isVisible()) {
      await expect(
        views.getByRole('link', { name: 'All products' }),
      ).toHaveAttribute('aria-current', 'page');
    }
  });

  test('does not search on one character, and says why', async ({ page }) => {
    await page.goto('/products');
    await expectLoadedOrReported(page);

    const search = page.getByLabel('Search your supplier products');

    if (!(await search.isVisible())) return;

    await search.fill('a');
    await expect(
      page.getByText('Type at least 2 characters to search'),
    ).toBeVisible();
    // The URL is untouched: no live CJ search was submitted.
    await expect(page).not.toHaveURL(/[?&]q=/);
  });

  test('commits a two-or-more-character search to the URL', async ({
    page,
  }) => {
    await page.goto('/products');
    await expectLoadedOrReported(page);

    const search = page.getByLabel('Search your supplier products');

    if (!(await search.isVisible())) return;

    await search.fill('mug');
    await expect(page).toHaveURL(/[?&]q=mug/, { timeout: 10_000 });

    if (!(await search.isVisible())) return;

    // The typed value survives the navigation.
    await expect(search).toHaveValue('mug');
  });
});

test.describe('All Supplier Products on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('never scrolls the page sideways', async ({ page }) => {
    await page.goto('/products');
    await expectLoadedOrReported(page);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );

    expect(overflow).toBeLessThanOrEqual(1);
  });
});
