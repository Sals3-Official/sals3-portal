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
    // itself works. The sidebar entry goes straight to the supplier-
    // prefilled editor; the blank wizard stays reachable by typing
    // /listings/new directly (see the two tests above).
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

/**
 * Layout assertions for the Listing Readiness panel. These belong in a real
 * browser rather than jsdom: the panel switches its tab labels on a CSS
 * container query, and jsdom loads no stylesheet, so a unit test cannot see
 * which label is painted or whether anything overflows.
 */
test.describe('Listing Readiness - layout', () => {
  /** Wide enough for the three-column grid, so the 272px rail is visible. */
  const WIDE = { width: 1800, height: 1100 };

  async function probeTabs(scope: import('@playwright/test').Locator) {
    return scope.evaluate((root: HTMLElement) => {
      const tabs = Array.from(root.querySelectorAll('[role="tab"]'));

      return {
        overflowX: root.scrollWidth > root.clientWidth + 1,
        tabs: tabs.map((tab) => {
          const label = tab.querySelector('.truncate') as HTMLElement;

          return {
            text: (tab as HTMLElement).innerText.replace(/\s+/g, ' ').trim(),
            clipped: label.scrollWidth > label.clientWidth + 1,
          };
        }),
      };
    });
  }

  test('the rail shows both tabs whole, with no clipping or overflow', async ({
    page,
  }) => {
    await page.setViewportSize(WIDE);
    await page.goto(EDITOR_URL);

    const panel = page.locator('aside .rounded-lg').first();

    await expect(panel).toBeVisible();

    const probe = await probeTabs(panel);

    expect(probe.overflowX).toBe(false);
    expect(probe.tabs.map((tab) => tab.clipped)).toEqual([false, false]);
    // Below the 19rem threshold the labels shorten rather than ellipsize.
    expect(probe.tabs.map((tab) => tab.text)).toEqual([
      'Issues (4)',
      'Changes (0)',
    ]);
  });

  test('the header states status, percentage and progress above the tabs', async ({
    page,
  }) => {
    await page.setViewportSize(WIDE);
    await page.goto(EDITOR_URL);

    const panel = page.locator('aside .rounded-lg').first();
    const progress = panel.getByRole('progressbar', {
      name: 'Listing completeness',
    });

    await expect(panel.getByText('Needs attention')).toBeVisible();
    await expect(panel.getByText('78% complete')).toBeVisible();
    await expect(progress).toHaveAttribute('aria-valuenow', '78');

    const [progressTop, tablistTop] = await Promise.all([
      progress.evaluate((el) => el.getBoundingClientRect().top),
      panel
        .getByRole('tablist')
        .evaluate((el) => el.getBoundingClientRect().top),
    ]);

    expect(progressTop).toBeLessThan(tablistTop);

    // The status and the percentage describe the listing, not the issues
    // tab, so they must survive a tab change - they used to disappear.
    await panel.getByRole('tab', { name: /Changes/ }).click();
    await expect(panel.getByText('78% complete')).toBeVisible();
    await expect(progress).toBeVisible();
  });

  test('the readiness sheet fits a 320px phone without clipping', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto(EDITOR_URL);

    await page.getByRole('button', { name: 'Readiness' }).click();

    const sheet = page.getByRole('dialog', { name: 'Listing Readiness' });

    await expect(sheet).toBeVisible();

    const probe = await probeTabs(sheet);

    expect(probe.overflowX).toBe(false);
    expect(probe.tabs.map((tab) => tab.clipped)).toEqual([false, false]);

    const documentOverflows = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );

    expect(documentOverflows).toBe(false);
  });
});
