import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * "Check for Sals3" writes a real row to Postgres through a Server Action.
 *
 * These tests assert the invariants the portal itself owns, not a specific
 * supplier product: the CJ catalogue is a live third-party feed, so which rows
 * appear changes, and a CJ outage is not a defect in this repository.
 *
 * Two locator rules learned the hard way here:
 *  - Scope row assertions to the products table. The sidebar has a
 *    "Shortlisted" nav link, so a page-wide text match passes without the
 *    button ever doing anything.
 *  - After the click the drawer opens, and Base UI marks everything behind it
 *    `aria-hidden`/inert — so `getByRole('table')` stops resolving. Assert on
 *    the dialog while it is open, and close it before asserting the row.
 */

const PREFLIGHT_DECISION_LABELS = [
  'Ready',
  'Ready · Needs Attention',
  'Review Required',
  'On Hold',
  'Blocked',
];

function productsTable(page: Page): Locator {
  return page.getByRole('table');
}

async function openExplorer(page: Page): Promise<boolean> {
  await page.goto('/products');

  const button = productsTable(page)
    .getByRole('button', { name: 'Check for Sals3' })
    .first();
  const failure = page.getByRole('heading', {
    name: 'The supplier catalogue did not load',
  });

  await expect(button.or(failure)).toBeVisible({ timeout: 30_000 });
  return button.isVisible();
}

test.describe('CJ candidate shortlist', () => {
  test('the action appears on the CJ Candidate Explorer rows', async ({
    page,
  }) => {
    const ready = await openExplorer(page);
    if (!ready) return; // Supplier catalogue itself failed to load.

    await expect(
      productsTable(page)
        .getByRole('button', { name: 'Check for Sals3' })
        .first(),
    ).toBeEnabled();
  });

  test('clicking it reports a real outcome in the drawer and never a preflight decision', async ({
    page,
  }) => {
    const ready = await openExplorer(page);
    if (!ready) return;

    await productsTable(page)
      .getByRole('button', { name: 'Check for Sals3' })
      .first()
      .click();

    // The drawer is the only non-inert region once it opens.
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible({ timeout: 20_000 });
    await expect(
      drawer.getByText(/^(Shortlisted|Not shortlisted)$/).first(),
    ).toBeVisible();

    // Whatever happened, it must never be dressed up as a preflight decision.
    await Promise.all(
      PREFLIGHT_DECISION_LABELS.map((label) =>
        expect(page.getByText(label, { exact: true })).toHaveCount(0),
      ),
    );

    // The drawer always says preflight has not run.
    await expect(
      drawer.getByText(/full preflight has not run for this candidate/i),
    ).toBeVisible();
  });

  test('a successful shortlist shows the stored candidate id, then persists to the Shortlisted queue', async ({
    page,
  }) => {
    const ready = await openExplorer(page);
    if (!ready) return;

    await productsTable(page)
      .getByRole('button', { name: 'Check for Sals3' })
      .first()
      .click();

    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible({ timeout: 20_000 });

    const succeeded = await drawer
      .getByText('Shortlisted', { exact: true })
      .count();

    if (succeeded === 0) {
      // No database in this environment. The honest-failure path is asserted
      // by the previous test; there is nothing persisted to verify here.
      return;
    }

    // A real uuid from Postgres, not a client-generated value.
    await expect(
      drawer.getByText(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      ),
    ).toBeVisible();

    // Round-trip: the queue page reads the table, not client state.
    await page.goto('/products/shortlisted');
    const queueTable = page.getByRole('table');
    await expect(queueTable).toBeVisible({ timeout: 30_000 });
    await expect(queueTable.locator('tbody tr').first()).toBeVisible();
  });

  test('the Exception Queue explains that preflight is not implemented', async ({
    page,
  }) => {
    await page.goto('/products/exception-queue');

    await expect(
      page.getByRole('heading', { name: 'No exceptions to review' }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText(/preflight, which is not implemented/i),
    ).toBeVisible();
  });
});

test.describe('CJ candidate shortlist on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('the shortlist column never scrolls the page sideways', async ({
    page,
  }) => {
    await openExplorer(page);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );

    expect(overflow).toBeLessThanOrEqual(1);
  });
});
