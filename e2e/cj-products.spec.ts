import { expect, test, type Page } from '@playwright/test';

/**
 * All Supplier Products.
 *
 * As of the lean intake policy (ADR-013 §1a) this page calls no third-party
 * API at all: it renders what discovery already persisted. These tests assert
 * what the portal itself controls - the labelling, the URL contract, the
 * quick views and filters, the corrected search behaviour, and that a missing
 * database or an empty catalogue is reported honestly rather than left blank.
 *
 * They deliberately never assert that a particular supplier product is
 * present: which products exist depends on how far discovery has run in the
 * environment under test.
 */

/**
 * Either the workspace rendered, or the environment honestly has no database
 * configured (expected in CI/preview - see `isDatabaseConfigured()`). Never
 * neither, and never a silent crash.
 */
async function expectLoadedOrReported(page: Page): Promise<void> {
  const notice = page
    .getByRole('main')
    .getByText(
      'Browsing, searching, filtering, paging, and opening source details all read saved Sals3 data',
    );
  const noDatabase = page.getByRole('heading', {
    name: 'No database configured in this environment',
  });
  const empty = page.getByRole('heading', {
    name: 'No supplier products discovered yet',
  });

  await expect(notice.or(noDatabase).or(empty)).toBeVisible({
    timeout: 30_000,
  });
}

test.describe('All Supplier Products', () => {
  test('renders the local catalogue at /products', async ({ page }) => {
    await page.goto('/products');

    await expectLoadedOrReported(page);
    await expect(
      page.getByRole('heading', { name: 'All Supplier Products' }),
    ).toBeVisible();
  });

  test('still renders for an old ?source=cj / ?cjPage link', async ({
    page,
  }) => {
    await page.goto('/products?source=cj&cjPage=99999999&cjSearch=x');

    await expectLoadedOrReported(page);
  });

  test('states plainly that browsing makes no supplier request', async ({
    page,
  }) => {
    await page.goto('/products');
    await expectLoadedOrReported(page);

    const notice = page.getByText(
      'Browsing, searching, filtering, paging, and opening source details all read saved Sals3 data',
    );

    if (await notice.isVisible()) {
      await expect(notice).toContainText('make no supplier request');
      await expect(notice).toContainText(
        'Stock is confirmed only by a person recording a CJ/MyCJ inspection',
      );
    }
  });

  test('offers the saved local quick views under the page title', async ({
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
        views.getByRole('link', { name: 'CJ Trending' }),
      ).toBeVisible();
      await expect(
        views.getByRole('link', { name: 'Most listed' }),
      ).toBeVisible();
      await expect(
        views.getByRole('link', { name: 'New arrivals' }),
      ).toBeVisible();
      await expect(
        views.getByRole('link', { name: /Needs attention/ }),
      ).toBeVisible();
    }
  });

  test('offers Discovery signal and Category filters in the table filter bar', async ({
    page,
  }) => {
    await page.goto('/products');
    await expectLoadedOrReported(page);

    const signal = page.getByLabel('Discovery signal');
    const category = page.getByLabel('Category');

    if (await signal.isVisible()) {
      await expect(signal).toBeEnabled();
      await expect(category).toBeEnabled();
    }
  });

  test('keeps the active quick view in a shareable URL', async ({ page }) => {
    await page.goto('/products?view=needs-attention');

    await expectLoadedOrReported(page);

    const views = page.getByRole('navigation', { name: 'Saved views' });

    if (await views.isVisible()) {
      await expect(
        views.getByRole('link', { name: /Needs attention/ }),
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
    // The URL is untouched: no server search was submitted.
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
    // The typed value survives the navigation.
    await expect(search).toHaveValue('mug');
  });

  test('clearing the search restores the unfiltered scoped set', async ({
    page,
  }) => {
    await page.goto('/products?q=mug');
    await expectLoadedOrReported(page);

    const search = page.getByLabel('Search your supplier products');

    if (!(await search.isVisible())) return;

    await search.fill('');
    await expect(page).not.toHaveURL(/[?&]q=/, { timeout: 10_000 });
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
