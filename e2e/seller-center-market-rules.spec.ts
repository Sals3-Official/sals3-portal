import { expect, test } from '@playwright/test';

test.describe('Seller Center market rules', () => {
  test('shows the role explainer', async ({ page }) => {
    await page.goto('/market-rules');

    await expect(page.getByText('Owner (seller manager)')).toBeVisible();
    await expect(page.getByText('Staff (seller staff)')).toBeVisible();
  });

  /**
   * Market setup left this page by owner decision on 2026-08-20 — a different
   * business model is coming for destination setup, and ADR-014 puts market
   * governance in the Admin Portal rather than a tenant screen. Asserted as an
   * absence so re-mounting it is a deliberate act with a failing test to
   * answer for, not a quiet re-appearance.
   */
  test('no longer carries market setup or the platform policy panel', async ({
    page,
  }) => {
    await page.goto('/market-rules');

    await expect(
      page.getByRole('heading', { name: 'Your market setup' }),
    ).toHaveCount(0);
    await expect(page.getByText('Global catalogue destinations')).toHaveCount(
      0,
    );
    await expect(page.getByText('Sals3 business registration')).toHaveCount(0);
    await expect(page.getByText('Set up a destination')).toHaveCount(0);
  });

  test('never presents the illustrative PH/ID/SG fixture as real configuration', async ({
    page,
  }) => {
    await page.goto('/market-rules');

    // Values that only exist in `lib/seller-center/market-config.ts`.
    const fixtureValues = [
      'J&T Express',
      'GCash wallet',
      'JNE Reguler',
      'Ninja Van',
      'DBS current account',
      'withholding tax',
    ];

    await Promise.all(
      fixtureValues.map((value) =>
        expect(page.getByText(value)).toHaveCount(0),
      ),
    );
  });

  /**
   * A live price must never move because somebody opened a dialog.
   *
   * The write is gated behind a preview the seller has to ask for, and this
   * asserts the gate exists on the real screen rather than only in the
   * component test — the ordering is the whole safety property.
   */
  test('repricing live prices is offered, and cannot be applied unlooked-at', async ({
    page,
  }) => {
    await page.goto('/market-rules');

    await page.getByRole('button', { name: /Reprice live products/ }).click();

    const dialog = page.getByRole('dialog', {
      name: 'Reprice published products',
    });

    await expect(
      dialog.getByRole('heading', { name: 'Reprice published products' }),
    ).toBeVisible();
    await expect(dialog.getByText('1. Check what would change')).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Apply new prices' }),
    ).toBeDisabled();
    // The reason field only appears once there is something to explain.
    //
    // Scoped to the dialog, and it has to be: `/market-rules` also renders the
    // Funding Buffer card, which carries a "Reason for change" field of its
    // own. A page-wide locator found that one and read a legitimately present
    // field as this dialog's, so the assertion failed while both the dialog
    // and the test's intent were correct.
    await expect(dialog.getByLabel('Reason for change')).toHaveCount(0);
  });
});
