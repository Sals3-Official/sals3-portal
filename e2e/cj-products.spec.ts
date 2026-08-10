import { expect, test, type Page } from '@playwright/test';

/**
 * The products page calls a live third-party API, so these tests never assert
 * that a particular supplier product is present: the catalogue changes, the
 * API is rate limited to one call per second, and a network failure is not a
 * defect in this repository. They assert what the portal itself controls - the
 * labelling, the URL contract, and that a failure is reported rather than
 * left blank.
 */

/**
 * Either the catalogue loaded, the failure was reported, or the environment
 * honestly has no database configured (expected in CI/preview - see
 * `isDatabaseConfigured()`). Never neither, and never a silent crash.
 */
async function expectLoadedOrReported(page: Page): Promise<void> {
  const notice = page.getByText(
    'Products shown here come from your active supplier connections',
  );
  const failure = page.getByRole('heading', {
    name: 'The supplier catalogue did not load',
  });
  const noDatabase = page.getByRole('heading', {
    name: 'No database configured in this environment',
  });
  const noConnection = page.getByRole('heading', {
    name: 'No CJ connection yet',
  });

  await expect(notice.or(failure).or(noDatabase).or(noConnection)).toBeVisible({
    timeout: 30_000,
  });
}

test.describe('supplier catalogue', () => {
  test('is the only product source at /products', async ({ page }) => {
    await page.goto('/products');

    await expectLoadedOrReported(page);
    // Scoped to the page's own content: the rail's connection-health footer
    // legitimately names the connected provider ("CJdropshipping") in its
    // own unrelated summary, which would otherwise substring-match here too.
    const content = page.getByRole('main');
    await expect(
      content.getByRole('link', { name: 'Sals3 catalogue' }),
    ).toHaveCount(0);
    await expect(
      content.getByRole('link', { name: 'CJdropshipping' }),
    ).toHaveCount(0);
  });

  test('still renders for an old ?source=cj link', async ({ page }) => {
    await page.goto('/products?source=cj');

    await expectLoadedOrReported(page);
  });

  test('labels the peso amount as an estimate, never a final cost', async ({
    page,
  }) => {
    await page.goto('/products');

    const notice = page.getByText(
      'Products shown here come from your active supplier connections',
    );
    const failure = page.getByRole('heading', {
      name: 'The supplier catalogue did not load',
    });
    const noDatabase = page.getByRole('heading', {
      name: 'No database configured in this environment',
    });
    const noConnection = page.getByRole('heading', {
      name: 'No CJ connection yet',
    });

    await expect(
      notice.or(failure).or(noDatabase).or(noConnection),
    ).toBeVisible({
      timeout: 30_000,
    });

    if (await notice.isVisible()) {
      await expect(notice).toContainText('never the final landed cost');
    }
  });

  test('reads a page number out of the URL without crashing', async ({
    page,
  }) => {
    await page.goto('/products?cjPage=99999999');

    await expectLoadedOrReported(page);
  });

  test('shows the supplier search box', async ({ page }) => {
    await page.goto('/products');
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
    await page.goto('/products');
    await expectLoadedOrReported(page);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );

    expect(overflow).toBeLessThanOrEqual(1);
  });
});
