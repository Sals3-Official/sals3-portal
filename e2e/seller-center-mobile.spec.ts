import { expect, test } from '@playwright/test';

const SELLER_CENTER_ROUTES = [
  '/overview',
  '/orders',
  '/listings/new',
  '/inventory',
  '/finances',
  '/payouts',
  '/market-rules',
];

test.describe('Seller Center on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  SELLER_CENTER_ROUTES.forEach((route) => {
    test(`${route} never scrolls the page sideways`, async ({ page }) => {
      await page.goto(route);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );

      expect(overflow).toBeLessThanOrEqual(1);
    });
  });
});
