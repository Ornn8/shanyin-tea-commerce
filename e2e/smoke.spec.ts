import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { LOCALE_IDS } from '../src/i18n/registry';
import { en } from '../src/i18n/messages/en';

const LOCALES = [...LOCALE_IDS];

function assertNoHorizontalOverflow(page: import('@playwright/test').Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

test.describe('storefront smoke — all locales', () => {
  for (const locale of LOCALES) {
    test(`${locale} home: localized catalog, no horizontal overflow, screenshot`, async ({ page }, testInfo) => {
      await page.goto(`/${locale}`);
      await expect(page.getByTestId('hero-title')).toBeVisible();
      await expect(page.getByTestId('demo-banner')).toBeVisible();
      await expect(page.getByTestId('product-grid')).toBeVisible();
      await expect(page.getByTestId('product-card')).toHaveCount(6);
      await expect(page.getByTestId('category-shortcuts')).toBeVisible();

      const overflow = await assertNoHorizontalOverflow(page);
      expect(overflow).toBeLessThanOrEqual(1);

      await page.screenshot({
        path: `e2e/screenshots/${testInfo.project.name}/${locale}-home.png`,
        fullPage: true,
      });
    });

    test(`${locale} product detail: same facts, localized copy, no overflow`, async ({ page }, testInfo) => {
      await page.goto(`/${locale}/products/spring-longjing`);
      await expect(page.getByTestId('product-name')).toBeVisible();
      await expect(page.getByTestId('add-to-cart')).toBeVisible();
      await expect(page.getByTestId('stock-status')).toBeVisible();
      const overflow = await assertNoHorizontalOverflow(page);
      expect(overflow).toBeLessThanOrEqual(1);
      if (locale === 'zh-CN' || locale === 'en') {
        await page.screenshot({
          path: `e2e/screenshots/${testInfo.project.name}/${locale}-product.png`,
          fullPage: true,
        });
      }
    });
  }

  test('ja falls back to English for the deliberately missing optional key', async ({ page }) => {
    await page.goto('/ja');
    await expect(page.getByTestId('announcement')).toHaveText(en['home.announcement']);
  });

  test('rapid locale switching settles on the last selection', async ({ page }) => {
    await page.goto('/en');
    await page.selectOption('#locale-picker', 'zh-CN');
    await page.selectOption('#locale-picker', 'ja');
    await expect(page).toHaveURL(/\/ja$/);
    await expect(page.getByTestId('hero-title')).toContainText('茶屋');
    // persisted choice survives a reload
    await page.reload();
    await expect(page).toHaveURL(/\/ja$/);
  });

  test('currency stays CNY and formats per locale from the same amount', async ({ page }) => {
    await page.goto('/en');
    const enPrice = await page.getByTestId('product-card').first().locator('.price-ticket').textContent();
    await page.goto('/zh-CN');
    const zhPrice = await page.getByTestId('product-card').first().locator('.price-ticket').textContent();
    expect(enPrice).toMatch(/CN¥[\d,]+\.\d{2}/);
    expect(zhPrice).toMatch(/¥[\d,]+\.\d{2}/);
    const digits = (value: string) => value.replace(/\D/g, '');
    expect(digits(enPrice!)).toBe(digits(zhPrice!));
  });

  test('add to cart updates the badge and the cart page total', async ({ page }) => {
    await page.goto('/en');
    await page.getByTestId('product-card').first().click();
    await page.getByTestId('add-to-cart').click();
    await expect(page.getByTestId('cart-count')).toHaveText('1');
    await page.goto('/en/cart');
    await expect(page.getByTestId('cart-items')).toBeVisible();
    await expect(page.getByTestId('cart-total')).toBeVisible();
  });

  test('search finds a tea by localized name', async ({ page }) => {
    await page.goto('/en');
    await page.getByRole('searchbox').fill('Longjing');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByTestId('search-summary')).toContainText('Longjing');
    await expect(page.getByTestId('product-card')).toHaveCount(1);
  });
});

test.afterAll(() => {
  if (process.env.GITHUB_SHA) {
    mkdirSync('e2e/screenshots', { recursive: true });
    writeFileSync(
      'e2e/screenshots/commit.txt',
      `commit=${process.env.GITHUB_SHA}\nrun_id=${process.env.GITHUB_RUN_ID ?? 'local'}\nworkflow=${process.env.GITHUB_WORKFLOW ?? 'CI'}\n`,
    );
  }
});
