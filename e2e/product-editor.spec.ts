import { expect, test } from '@playwright/test';

/**
 * The Product Editor is the supplier-prefilled mode of Add Product,
 * reached by `?fixture=` while it is a design preview. These cases cover
 * the route contract - which URLs resolve, which 404 - and the two
 * properties that would be actively misleading if they regressed: a
 * blocked product must never look publishable, and a real candidate id
 * must never be answered with fictional data.
 */

const EDITOR_URL = '/listings/new?fixture=attention';

test.describe('Add Product - supplier-prefilled editor', () => {
  test('an allow-listed fixture renders the editor', async ({ page }) => {
    await page.goto(EDITOR_URL);

    await expect(
      page.getByText('UI preview using fictional product data'),
    ).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(
      page.getByRole('button', { name: 'Publish with Attention' }),
    ).toBeEnabled();
  });

  /**
   * The editor has to be reachable by clicking, not only by typing a query
   * string. Add Product is the nav entry for both modes, so both have to be
   * one click from it.
   */
  test('is reachable from Add Product without typing a URL', async ({
    page,
  }) => {
    await page.goto('/listings/new');
    await page.getByRole('link', { name: 'Open the Product Editor' }).click();

    await expect(
      page.getByText('UI preview using fictional product data'),
    ).toBeVisible();
  });

  test('is reachable from the sidebar under Add Product', async ({ page }) => {
    // Not /overview: that page has its own "Add Product" action button in
    // its header, which would collide with the sidebar link of the same
    // name. Any page without a competing button proves the sidebar link
    // itself works.
    await page.goto('/supplier-apps');
    await page.getByRole('link', { name: 'Add Product' }).click();

    await expect(
      page.getByText('UI preview using fictional product data'),
    ).toBeVisible();
  });

  /**
   * The status, not just the body. A streamed 404 page served under a 200
   * still reads as "this exists" to anything that is not a human looking
   * at the screen - which is why this route has no `loading.tsx`.
   */
  test('an unknown fixture is a 404, not a default product', async ({
    page,
  }) => {
    const response = await page.goto('/listings/new?fixture=not-a-fixture');

    expect(response?.status()).toBe(404);
  });

  test('a real candidate id is acknowledged, never filled with fixture data', async ({
    page,
  }) => {
    await page.goto(
      '/listings/new?supplierCandidateId=8f2c1a7e-6f0b-4a1d-9d3e-77e2c0b41a55',
    );

    await expect(page.getByText('is not wired up yet')).toBeVisible();
    await expect(page.getByText('Aurelis')).toHaveCount(0);
  });

  test('a blocked product cannot publish and says why on screen', async ({
    page,
  }) => {
    await page.goto('/listings/new?fixture=blocked');

    const publish = page.getByRole('button', { name: 'Publish Product' });

    await expect(publish).toBeDisabled();
    await expect(
      page.getByText('3 hard blockers must clear first').first(),
    ).toBeVisible();
  });

  test('the supplier source drawer opens, closes on Escape, and shows no credential', async ({
    page,
  }) => {
    await page.goto(EDITOR_URL);
    await page
      .getByRole('button', { name: 'Supplier Source Details', exact: true })
      .click();

    const drawer = page.getByRole('dialog', {
      name: 'Supplier Source Details',
    });

    await expect(drawer).toBeVisible();
    await expect(
      drawer.getByText('No API key, token or credential is ever shown'),
    ).toBeVisible();
    await expect(drawer).not.toContainText(/api[_-]?key:/i);

    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
  });

  /**
   * The preview lives in a drawer at this width: the portal rail leaves
   * well under the space three columns need, which is the container-query
   * behaviour working rather than a missing panel.
   */
  test('the draft preview Add to Cart does nothing', async ({ page }) => {
    await page.goto(EDITOR_URL);
    await page.getByRole('button', { name: 'Preview' }).click();

    const preview = page.getByRole('dialog', {
      name: 'Draft Storefront Preview',
    });

    await expect(
      preview.getByRole('button', { name: 'Add to Cart' }),
    ).toBeDisabled();
  });
});

test.describe('Add Product on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('never scrolls the page sideways, despite the variant table', async ({
    page,
  }) => {
    await page.goto(EDITOR_URL);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );

    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('reaches readiness and preview through the header triggers', async ({
    page,
  }) => {
    await page.goto(EDITOR_URL);

    await page.getByRole('button', { name: 'Readiness' }).click();

    const readiness = page.getByRole('dialog', { name: 'Listing Readiness' });

    await expect(readiness).toBeVisible();
    // `attention` has no blockers, so the panel collapses the empty "Hard
    // blockers" group into one positive line instead of an empty card.
    await expect(readiness.getByText('No publication blockers')).toBeVisible();
    await expect(
      readiness.getByRole('heading', { name: 'Warnings' }),
    ).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(readiness).toBeHidden();

    await page.getByRole('button', { name: 'Preview' }).click();
    await expect(
      page.getByRole('dialog', { name: 'Draft Storefront Preview' }),
    ).toBeVisible();
  });
});
