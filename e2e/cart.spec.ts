import { expect, test, type Locator } from '@playwright/test';
import { serializeCart, type CartItem } from '../src/lib/cart';
import { LOCALE_IDS, type LocaleId } from '../src/i18n/registry';
import {
  CART_SKU_LONGNAME,
  CART_SKU_MAIN,
  CART_SKU_REVALIDATE,
  cleanupCartE2e,
  disconnectCartE2e,
  seedCartE2e,
  setProductPublished,
  setVariantInventory,
  setVariantPrice,
} from './helpers/cart-db';

/**
 * Cart journeys (Issue #5 acceptance) at desktop (1440×900) and mobile
 * (390×844) widths:
 *
 *  - one full add-to-cart path per locale: add → badge → quantity → subtotal +
 *    clearly labeled non-binding shipping estimate (flat below the free
 *    threshold, free at/over it) → estimated total;
 *  - recovery across refresh and locale switch (lines never duplicated or
 *    dropped, SKU identity stable);
 *  - server-side revalidation: a concurrent stock change clamps the quantity
 *    and reports it, a price change is reported against the stored snapshot,
 *    an un-published product is removed with a localized notice;
 *  - an expired/tampered cart cookie surfaces the localized expired state;
 *  - keyboard operation + screen-reader live region + focus restoration after
 *    removal, long labels (incl. Japanese) wrapping without overflow;
 *  - no horizontal overflow at either viewport, screenshots for CI.
 */

const BASE_URL = 'http://127.0.0.1:3100';

const NEXT_LOCALE: Record<LocaleId, LocaleId> = {
  'zh-CN': 'en',
  en: 'ja',
  ja: 'zh-CN',
};

const PRIMARY_NAMES: Record<LocaleId, string> = {
  'zh-CN': '购物袋演示茶',
  en: 'Cart Demo Tea',
  ja: 'カートデモ茶',
};

const LONG_NAMES: Record<LocaleId, string> = {
  'zh-CN': '购物袋端到端测试示例茶叶——这是特意加长的商品名称，用于验证在窄屏幕上能够自动换行而不是溢出',
  en: 'E2E Cart Tea with an Exceptionally Long English Product Title That Must Wrap Gracefully Instead of Overflowing on Narrow Screens',
  ja: 'カートE2Eテスト用の非常に長い日本語の茶葉名で、画面の幅が狭くても折り返して表示されることを確認するためのものです',
};

/** Locale-specific token the live region reports a quantity change with. */
const QTY_WORD: Record<LocaleId, string> = {
  'zh-CN': '数量',
  en: 'quantity',
  ja: '数量',
};

function assertNoHorizontalOverflow(page: import('@playwright/test').Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

/** Parse a price text into integer cents (locale-tolerant: strips symbols). */
async function centsOf(locator: Locator): Promise<number> {
  const text = (await locator.textContent()) ?? '';
  return parseInt(text.replace(/\D/g, '') || '0', 10);
}

test.describe('cart — full add-to-cart journey per locale', () => {
  test.beforeAll(async () => {
    await seedCartE2e();
  });
  test.afterAll(async () => {
    await cleanupCartE2e();
    await disconnectCartE2e();
  });

  for (const locale of LOCALE_IDS) {
    test(`${locale}: add, quantities, non-binding shipping estimate, recovery, locale switch`, async ({ page }, testInfo) => {
      const next = NEXT_LOCALE[locale];

      // 1. Add the default variant (¥150.00) from the product page.
      await page.goto(`/${locale}/products/e2e-cart-primary`);
      await expect(page.getByTestId('product-name')).toHaveText(PRIMARY_NAMES[locale]);
      await page.getByTestId('add-to-cart').click();
      await expect(page.getByTestId('cart-count')).toHaveText('1');

      // 2. Cart page: one line with quantity 1 and the exact variant's price.
      await page.goto(`/${locale}/cart`);
      await expect(page.getByTestId('cart-line')).toHaveCount(1);
      const line = page.getByTestId('cart-line').first();
      await expect(line).toContainText(CART_SKU_MAIN);
      await expect(page.getByTestId(`cart-qty-${CART_SKU_MAIN}`)).toHaveText('1');
      await expect(page.getByTestId('cart-line-price').first()).toHaveText(/\d/);
      expect(await centsOf(page.getByTestId('cart-line-price').first())).toBe(15000);

      // 3. Subtotal, flat shipping estimate (below the ¥200 threshold), total.
      await expect(page.getByTestId('cart-total')).toHaveText(/\d/);
      expect(await centsOf(page.getByTestId('cart-total'))).toBe(15000);
      await expect(page.getByTestId('cart-shipping-label')).toContainText(
        locale === 'zh-CN' ? '运费估算' : locale === 'ja' ? '送料見積' : 'Shipping estimate',
      );
      await expect(page.getByTestId('cart-shipping')).toHaveText(/\d/);
      expect(await centsOf(page.getByTestId('cart-shipping'))).toBe(1200);
      await expect(page.getByTestId('cart-shipping-free-note')).toHaveCount(0);
      await expect(page.getByTestId('cart-estimated-total')).toHaveText(/\d/);
      expect(await centsOf(page.getByTestId('cart-estimated-total'))).toBe(16200);

      // 4. Increase quantity to 2 → crosses the free-shipping threshold.
      await page.getByTestId(`cart-qty-increase-${CART_SKU_MAIN}`).click();
      await expect(page.getByTestId(`cart-qty-${CART_SKU_MAIN}`)).toHaveText('2');
      expect(await centsOf(page.getByTestId('cart-total'))).toBe(30000);
      expect(await centsOf(page.getByTestId('cart-shipping'))).toBe(0);
      await expect(page.getByTestId('cart-shipping-free-note')).toBeVisible();
      expect(await centsOf(page.getByTestId('cart-estimated-total'))).toBe(30000);

      // 5. Recovery: a refresh keeps quantity and line identity.
      await page.reload();
      await expect(page.getByTestId('cart-line')).toHaveCount(1);
      await expect(page.getByTestId(`cart-qty-${CART_SKU_MAIN}`)).toHaveText('2');

      // 6. Locale switch: presentation only — the same line, never doubled/lost.
      await page.selectOption('#locale-picker', next);
      await expect(page).toHaveURL(new RegExp(`/${next}/cart$`));
      await expect(page.getByTestId('cart-line')).toHaveCount(1);
      await expect(page.getByTestId('cart-line').first()).toContainText(CART_SKU_MAIN);
      await expect(page.getByTestId('cart-line').first()).toContainText(PRIMARY_NAMES[next]);

      // 7. Screenshot the populated localized cart for the CI artifact.
      await page.goto(`/${locale}/cart`);
      await expect(page.getByTestId('cart-line')).toHaveCount(1);
      await page.screenshot({
        path: `e2e/screenshots/${testInfo.project.name}/${locale}-cart.png`,
        fullPage: true,
      });

      // 8. Remove → localized empty state, badge gone.
      await page.getByTestId(`cart-remove-${CART_SKU_MAIN}`).click();
      await expect(page.getByTestId('cart-empty')).toBeVisible();
      await expect(page.getByTestId('cart-count')).toHaveCount(0);
      expect(await assertNoHorizontalOverflow(page)).toBeLessThanOrEqual(1);
    });

    test(`${locale}: keyboard, live region, long labels, focus restoration`, async ({ page }) => {
      // 1. Add the long-named product, then a second line.
      await page.goto(`/${locale}/products/e2e-cart-longname`);
      await page.getByTestId('add-to-cart').click();
      await expect(page.getByTestId('cart-count')).toHaveText('1');
      await page.goto(`/${locale}/products/e2e-cart-primary`);
      await page.getByTestId('add-to-cart').click();
      await expect(page.getByTestId('cart-count')).toHaveText('2');
      await page.goto(`/${locale}/cart`);

      // 2. The long localized name renders on one line (wrapping, no overflow).
      const longLine = page.getByTestId('cart-line').filter({ hasText: LONG_NAMES[locale] });
      await expect(longLine).toHaveCount(1);
      await expect(longLine.locator('a').first()).toHaveText(LONG_NAMES[locale]);
      expect(await assertNoHorizontalOverflow(page)).toBeLessThanOrEqual(1);

      // 3. Keyboard operation: focus the increase button and press Enter.
      const increase = page.getByTestId(`cart-qty-increase-${CART_SKU_LONGNAME}`);
      await increase.focus();
      await expect(increase).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.getByTestId(`cart-qty-${CART_SKU_LONGNAME}`)).toHaveText('2');
      // The polite live region announces the change (localized).
      await expect(page.getByTestId('cart-live')).toContainText(QTY_WORD[locale]);

      // 4. Focus restoration: removing a line returns focus to the heading.
      await page.getByTestId(`cart-remove-${CART_SKU_LONGNAME}`).click();
      await expect(page.getByTestId('cart-line')).toHaveCount(1);
      await expect(page.getByTestId('cart-title')).toBeFocused();
      await expect(page.getByTestId('cart-line').first()).toContainText(CART_SKU_MAIN);
    });
  }

  test('expired cart cookie surfaces the localized expired notice', async ({ page }) => {
    // A signed payload whose expiry is in the past: the server must never
    // display it and must communicate the cleared cart in the active locale.
    const expired: CartItem = { sku: CART_SKU_MAIN, qty: 2, priceCents: 15000, addedAt: 1 };
    await page.context().addCookies([
      { name: 'shanyin_cart', value: serializeCart([expired], 0), url: BASE_URL },
    ]);
    await page.goto('/en/cart');
    await expect(page.getByTestId('cart-expired')).toBeVisible();
    await expect(page.getByTestId('cart-empty')).toBeVisible();
    await expect(page.getByTestId('cart-line')).toHaveCount(0);
  });

  test('server revalidation: stock clamp, price change, and unpublish removal', async ({ page }) => {
    // Start with qty 2 of the ¥150.00 revalidation variant. Wait on the badge
    // after adding so the in-flight server action has persisted before we
    // navigate (an immediate navigation could abort the cookie write).
    await page.goto('/en/products/e2e-cart-revalidate');
    await page.getByTestId('add-to-cart').click();
    await expect(page.getByTestId('cart-count')).toHaveText('1');
    await page.goto('/en/cart');
    await page.getByTestId(`cart-qty-increase-${CART_SKU_REVALIDATE}`).click();
    await expect(page.getByTestId(`cart-qty-${CART_SKU_REVALIDATE}`)).toHaveText('2');

    try {
      // Concurrent price change: the cart reports it against the snapshot.
      await setVariantPrice(CART_SKU_REVALIDATE, 20000);
      await page.reload();
      await expect(page.getByTestId(`cart-price-changed-${CART_SKU_REVALIDATE}`)).toBeVisible();
      await expect(page.getByTestId(`cart-price-changed-${CART_SKU_REVALIDATE}`)).toContainText('200.00');
      await expect(page.getByTestId(`cart-price-changed-${CART_SKU_REVALIDATE}`)).toContainText('150.00');
      expect(await centsOf(page.getByTestId(`cart-line-total-${CART_SKU_REVALIDATE}`))).toBe(40000);

      // Concurrent stock change: quantity clamps to the current inventory.
      await setVariantInventory(CART_SKU_REVALIDATE, 1);
      await page.reload();
      await expect(page.getByTestId(`cart-insufficient-stock-${CART_SKU_REVALIDATE}`)).toBeVisible();
      await expect(page.getByTestId(`cart-qty-${CART_SKU_REVALIDATE}`)).toHaveText('1');
      expect(await centsOf(page.getByTestId(`cart-line-total-${CART_SKU_REVALIDATE}`))).toBe(20000);
      // The increase control is capped by the shared inventory.
      await expect(page.getByTestId(`cart-qty-increase-${CART_SKU_REVALIDATE}`)).toBeDisabled();

      // Unpublished product: the line is dropped with a localized notice.
      await setProductPublished('e2e-cart-revalidate', false);
      await page.reload();
      await expect(page.getByTestId('cart-removed-notice')).toBeVisible();
      await expect(page.getByTestId('cart-line')).toHaveCount(0);
      await expect(page.getByTestId('cart-empty')).toBeVisible();
    } finally {
      await setProductPublished('e2e-cart-revalidate', true);
      await setVariantInventory(CART_SKU_REVALIDATE, 10);
      await setVariantPrice(CART_SKU_REVALIDATE, 15000);
    }
  });
});