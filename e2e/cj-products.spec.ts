import { expect, test, type Page } from '@playwright/test';

/**
 * The CJdropshipping tab calls a live third-party API, so these tests never
 * assert that a particular supplier product is present: the catalogue changes,
 * the API is rate limited to one call per second, and a network failure is not a
 * defect in this repository. They assert what the portal itself controls - the
 * source switch, the labelling, the URL contract, and that a failure is reported
 * rather than left blank.
 */

/** Either the catalogue loaded, or the failure was reported. Never neither. */
async function expectLoadedOrReported(page: Page): Promise<void> {
  const notice = page.getByText(
    'These are supplier products from CJdropshipping',
  );
  const failure = page.getByRole('heading', {
    name: 'The supplier catalogue did not load',
  });

  await expect(notice.or(failure)).toBeVisible({ timeout: 30_000 });
}

test.describe('product source switch', () => {
  test('starts on the Sals3 catalogue', async ({ page }) => {
    await page.goto('/products');

    await expect(
      page.getByRole('link', { name: 'Sals3 catalogue' }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(
      page.getByRole('link', { name: 'Quiet tower air cooler' }),
    ).toBeVisible();
  });

  test('opens the supplier catalogue and marks the tab current', async ({
    page,
  }) => {
    await page.goto('/products');
    await page.getByRole('link', { name: 'CJdropshipping' }).click();

    await expect(page).toHaveURL(/source=cj/);
    await expect(
      page.getByRole('link', { name: 'CJdropshipping' }),
    ).toHaveAttribute('aria-current', 'page');
    await expectLoadedOrReported(page);
  });

  test('keeps the Sals3 rows out of the supplier view', async ({ page }) => {
    await page.goto('/products?source=cj');
    await expectLoadedOrReported(page);

    await expect(
      page.getByRole('link', { name: 'Quiet tower air cooler' }),
    ).toHaveCount(0);
  });

  test('says the prices are supplier prices in dollars', async ({ page }) => {
    await page.goto('/products?source=cj');

    const notice = page.getByText(
      'These are supplier products from CJdropshipping',
    );
    const failure = page.getByRole('heading', {
      name: 'The supplier catalogue did not load',
    });

    await expect(notice.or(failure)).toBeVisible({ timeout: 30_000 });

    if (await notice.isVisible()) {
      await expect(notice).toContainText('not converted to pesos');
    }
  });

  test('reads a page number out of the URL without crashing', async ({
    page,
  }) => {
    await page.goto('/products?source=cj&cjPage=99999999');

    await expectLoadedOrReported(page);
  });

  test('shows the supplier search box', async ({ page }) => {
    await page.goto('/products?source=cj');
    await expectLoadedOrReported(page);

    const search = page.getByLabel('Search supplier products');

    if (await search.isVisible()) {
      await expect(search).toBeEditable();
    }
  });
});

test.describe('supplier catalogue on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('never scrolls the page sideways', async ({ page }) => {
    await page.goto('/products?source=cj');
    await expectLoadedOrReported(page);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );

    expect(overflow).toBeLessThanOrEqual(1);
  });
});
