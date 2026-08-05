import { expect, test, type Page } from '@playwright/test';

/**
 * Interactions that depend on React state only work after hydration, and a
 * click that lands before it is lost with no visible error. Retrying the whole
 * step until the expected result appears keeps these tests honest without
 * adding an arbitrary sleep.
 */
async function retryUntil(step: () => Promise<void>): Promise<void> {
  await expect(step).toPass({ timeout: 15_000 });
}

async function selectRow(page: Page, name: string): Promise<void> {
  await retryUntil(async () => {
    await page.getByRole('checkbox', { name: `Select ${name}` }).click();
    await expect(page.getByText('1 product selected')).toBeVisible({
      timeout: 2_000,
    });
  });
}

test.describe('product list', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/products');
  });

  test('shows the catalogue with a heading and rows', async ({ page }) => {
    await expect(
      page.getByRole('heading', { level: 1, name: 'Products' }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Quiet tower air cooler' }),
    ).toBeVisible();
  });

  test('filters by status through the tabs and the URL', async ({ page }) => {
    await page.getByRole('link', { name: /^Draft/ }).click();

    await expect(page).toHaveURL(/status=draft/);
    await expect(
      page.getByRole('link', { name: 'USB desk fan with timer' }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Quiet tower air cooler' }),
    ).toHaveCount(0);
  });

  test('searches by product name', async ({ page }) => {
    await retryUntil(async () => {
      await page.getByLabel('Search').fill('sunscreen');
      await expect(page).toHaveURL(/q=sunscreen/, { timeout: 2_000 });
    });

    await expect(
      page.getByRole('link', { name: 'Daily face sunscreen SPF 50' }),
    ).toBeVisible();
  });

  test('tells the user when a filter matches nothing', async ({ page }) => {
    await retryUntil(async () => {
      await page.getByLabel('Search').fill('nothing matches this');
      await expect(
        page.getByRole('heading', { name: 'No products match these filters' }),
      ).toBeVisible({ timeout: 2_000 });
    });

    await expect(
      page.getByRole('link', { name: 'Clear filters' }).first(),
    ).toBeVisible();
  });

  test('sorts by price from the column header', async ({ page }) => {
    await page.getByRole('link', { name: /Sort by price/ }).click();

    await expect(page).toHaveURL(/sort=price-asc/);
  });

  test('shows bulk actions after a row is selected', async ({ page }) => {
    await selectRow(page, 'Quiet tower air cooler');

    await expect(
      page.getByRole('button', { name: 'Publish', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Unpublish' })).toBeVisible();
  });

  test('asks for confirmation before a bulk delete', async ({ page }) => {
    await selectRow(page, 'Quiet tower air cooler');
    await page.getByRole('button', { name: 'Delete' }).click();

    await expect(
      page.getByRole('heading', { name: 'Delete 1 product?' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Keep them' }).click();
    await expect(
      page.getByRole('link', { name: 'Quiet tower air cooler' }),
    ).toBeVisible();
  });
});

test.describe('product detail', () => {
  test('opens the detail page and switches tabs', async ({ page }) => {
    await page.goto('/products/air-cooler');

    await expect(
      page.getByRole('heading', { level: 1, name: 'Quiet tower air cooler' }),
    ).toBeVisible();

    await retryUntil(async () => {
      await page.getByRole('tab', { name: 'Analytics' }).click();
      await expect(page.getByText('Conversion rate')).toBeVisible({
        timeout: 2_000,
      });
    });

    await page.getByRole('tab', { name: 'History' }).click();
    await expect(
      page.getByRole('columnheader', { name: 'Before' }),
    ).toBeVisible();
  });

  test('shows the rejection reason on a rejected product', async ({ page }) => {
    await page.goto('/products/wireless-earbuds');

    await expect(
      page.getByRole('heading', { name: 'Why this product was rejected' }),
    ).toBeVisible();
  });
});

test.describe('add product form', () => {
  test('reports field errors instead of saving an empty product', async ({
    page,
  }) => {
    await page.goto('/products/new');

    await page.getByLabel('Product name').fill('ab');
    await page.getByLabel('Description').fill('too short');

    await retryUntil(async () => {
      await page.getByRole('button', { name: 'Save as draft' }).click();
      await expect(
        page.getByText('Enter a product name with at least 3 characters.'),
      ).toBeVisible({ timeout: 3_000 });
    });
  });

  test('keeps the eight form sections reachable', async ({ page }) => {
    await page.goto('/products/new');

    await retryUntil(async () => {
      await page.getByRole('tab', { name: 'Search settings' }).click();
      await expect(page.getByLabel('Page title')).toBeVisible({
        timeout: 2_000,
      });
    });

    await page.getByRole('tab', { name: 'Variants' }).click();
    await expect(
      page.getByRole('button', { name: 'Add variant' }),
    ).toBeVisible();
  });
});

test.describe('mobile layout', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('shows product cards and never scrolls the page sideways', async ({
    page,
  }) => {
    await page.goto('/products');

    await expect(
      page.getByRole('link', { name: 'Quiet tower air cooler' }),
    ).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );

    expect(overflow).toBeLessThanOrEqual(1);
  });
});
