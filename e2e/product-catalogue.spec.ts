import { expect, test } from '@playwright/test';

/**
 * The Product Catalogue at `/listings`. These cases cover
 * the properties that would be actively misleading if they regressed: the
 * approved listing lifecycle (not a retail Active/Inactive/Pending QC/
 * Violation/Deleted set), Archive replacing Delete when a row exists, a
 * non-Live row never offering a working "View Live Page", and an honest empty
 * state. Catalogue rows are database-backed, so row-level checks are conditional
 * in empty local/CI databases.
 */

test.describe('Product Catalogue preview', () => {
  test('renders the approved listing-lifecycle tabs, not a retail status set', async ({
    page,
  }) => {
    await page.goto('/listings');

    const tabs = page.getByRole('tablist', {
      name: 'Filter by listing status',
    });

    await expect(tabs.getByRole('tab', { name: /^Draft/ })).toBeVisible();
    await expect(tabs.getByRole('tab', { name: /^Live$/ })).toBeVisible();
    await expect(
      tabs.getByRole('tab', { name: /Live · Needs Attention/ }),
    ).toBeVisible();
    await expect(tabs.getByRole('tab', { name: /Auto-paused/ })).toBeVisible();
    await expect(tabs.getByRole('tab', { name: /Archived/ })).toBeVisible();

    await expect(tabs.getByRole('tab', { name: 'Pending QC' })).toHaveCount(0);
    await expect(tabs.getByRole('tab', { name: 'Violation' })).toHaveCount(0);
    await expect(tabs.getByRole('tab', { name: 'Deleted' })).toHaveCount(0);
  });

  test('search with no matches renders an honest empty state, not a blank table', async ({
    page,
  }) => {
    await page.goto('/listings');

    await page
      .getByLabel('Product name', { exact: true })
      .fill('no such product exists anywhere zzz');

    await expect(
      page.getByText('No listings match the current filters.'),
    ).toBeVisible();
  });

  test('row actions offer Archive, never a bare Delete', async ({ page }) => {
    await page.goto('/listings');

    const actions = page.getByRole('button', { name: /^More actions for / });

    if ((await actions.count()) === 0) return;

    await actions.first().click();

    await expect(page.getByRole('menuitem', { name: 'Archive' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0);
  });

  test('a non-Live row disables View Live Page instead of offering a working link', async ({
    page,
  }) => {
    await page.goto('/listings');

    // Filter to Draft, where no row has a real storefront URL.
    await page.getByRole('tab', { name: /^Draft/ }).click();

    const draftActions = page.getByRole('button', {
      name: /^More actions for .* \(draft\)$/,
    });

    if ((await draftActions.count()) === 0) return;

    await draftActions.first().click();

    await expect(
      page.getByRole('menuitem', { name: /View Live Page/ }),
    ).toHaveAttribute('data-disabled');
  });
});

test.describe('Product Catalogue on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('never scrolls the page sideways', async ({ page }) => {
    await page.goto('/listings');

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );

    expect(overflow).toBeLessThanOrEqual(1);
  });
});
