import { expect, test, type Locator } from '@playwright/test';
import { serializeCart } from '../src/lib/cart-signing';
import type { CartItem } from '../src/lib/cart';
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
 *  - cross-tab serialization: concurrent additions from two tabs both persist
 *    (every cart cookie write runs under the storefront-wide lock);
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

/** English copy the add button shows when an add cannot grow the line. */
const ADD_INSUFFICIENT_EN = 'Only the in-stock quantity is available - nothing more could be added.';

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

/** Read the lines persisted in the live `shanyin_cart` cookie from the browser. */
async function cartCookieItems(page: import('@playwright/test').Page): Promise<Array<{ sku: string; qty: number }>> {
  return page.evaluate(() => {
    const match = document.cookie.match(/(?:^|;\s*)shanyin_cart=([^;]*)/);
    if (!match) return [];
    try {
      return (JSON.parse(decodeURIComponent(match[1]))?.items ?? []) as Array<{ sku: string; qty: number }>;
    } catch {
      return [];
    }
  });
}

async function hasCartCookie(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(() => document.cookie.includes(`shanyin_cart=`));
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

  test('expired cart cookie surfaces the localized notice, clears the cookie, and clears the badge', async ({ page }) => {
    // A signed payload whose expiry is in the past: the server must never
    // display it, must communicate the cleared cart in the active locale, and
    // must persist the cleanup — an expired cookie must not keep the header
    // badge counting on every reload.
    const expired: CartItem = { sku: CART_SKU_MAIN, qty: 2, priceCents: 15000, addedAt: 1 };
    await page.context().addCookies([
      { name: 'shanyin_cart', value: serializeCart([expired], 0), url: BASE_URL },
    ]);
    await page.goto('/en/cart');
    await expect(page.getByTestId('cart-expired')).toBeVisible();
    await expect(page.getByTestId('cart-empty')).toBeVisible();
    await expect(page.getByTestId('cart-line')).toHaveCount(0);
    // The reconciliation pass persists the cleanup: the cookie is removed and
    // the badge stops showing the stale count.
    await expect.poll(() => hasCartCookie(page)).toBe(false);
    await expect(page.getByTestId('cart-count')).toHaveCount(0);
    // A reload keeps it cleared — not just this render.
    await page.reload();
    await expect.poll(() => hasCartCookie(page)).toBe(false);
    await expect(page.getByTestId('cart-count')).toHaveCount(0);
  });

  test('reconciliation: an unpublished line is pruned from the cookie and does not reappear', async ({ page }) => {
    await page.goto('/en/products/e2e-cart-revalidate');
    await page.getByTestId('add-to-cart').click();
    await expect(page.getByTestId('cart-count')).toHaveText('1');

    try {
      await setProductPublished('e2e-cart-revalidate', false);
      await page.goto('/en/cart');
      await expect(page.getByTestId('cart-removed-notice')).toBeVisible();
      // The reconciliation pass prunes the unpublished SKU from the signed
      // cookie so it cannot reappear after the product is re-published.
      await expect
        .poll(async () => (await cartCookieItems(page)).some((line) => line.sku === CART_SKU_REVALIDATE))
        .toBe(false);

      await setProductPublished('e2e-cart-revalidate', true);
      await page.reload();
      await expect(page.getByTestId('cart-line')).toHaveCount(0);
      await expect(page.getByTestId('cart-count')).toHaveCount(0);
    } finally {
      await setProductPublished('e2e-cart-revalidate', true);
      await setVariantInventory(CART_SKU_REVALIDATE, 10);
      await setVariantPrice(CART_SKU_REVALIDATE, 15000);
    }
  });

  test('reconciliation: a stock clamp is persisted and does not jump back when stock is restored', async ({ page }) => {
    await page.goto('/en/products/e2e-cart-revalidate');
    await page.getByTestId('add-to-cart').click();
    await expect(page.getByTestId('cart-count')).toHaveText('1');
    await page.goto('/en/cart');
    await page.getByTestId(`cart-qty-increase-${CART_SKU_REVALIDATE}`).click();
    await expect(page.getByTestId(`cart-qty-${CART_SKU_REVALIDATE}`)).toHaveText('2');

    try {
      await setVariantInventory(CART_SKU_REVALIDATE, 1);
      await page.reload();
      await expect(page.getByTestId(`cart-insufficient-stock-${CART_SKU_REVALIDATE}`)).toBeVisible();
      await expect(page.getByTestId(`cart-qty-${CART_SKU_REVALIDATE}`)).toHaveText('1');
      // The reconciliation pass rewrites the stored quantity to the clamped
      // value (1), so it can never silently regain the old 2.
      await expect
        .poll(async () => (await cartCookieItems(page)).find((line) => line.sku === CART_SKU_REVALIDATE)?.qty ?? 0)
        .toBe(1);

      await setVariantInventory(CART_SKU_REVALIDATE, 10);
      await page.reload();
      // The persisted clamp holds: the quantity stays at 1 (no jump back), the
      // shortage flag clears, and the increase control is re-enabled by stock.
      await expect(page.getByTestId(`cart-qty-${CART_SKU_REVALIDATE}`)).toHaveText('1');
      await expect(page.getByTestId(`cart-insufficient-stock-${CART_SKU_REVALIDATE}`)).toHaveCount(0);
      await expect(page.getByTestId(`cart-qty-increase-${CART_SKU_REVALIDATE}`)).toBeEnabled();
      // The cookie itself holds the clamped quantity.
      const persisted = await cartCookieItems(page);
      expect(persisted.find((line) => line.sku === CART_SKU_REVALIDATE)?.qty).toBe(1);
    } finally {
      await setProductPublished('e2e-cart-revalidate', true);
      await setVariantInventory(CART_SKU_REVALIDATE, 10);
      await setVariantPrice(CART_SKU_REVALIDATE, 15000);
    }
  });

  test('serialization: a user mutation is never overwritten by background reconciliation', async ({ page }) => {
    // Cart holds MAIN (qty 1) and REVALIDATE (qty 2). Dropping REVALIDATE stock
    // to 1 makes this cart view NEED reconciliation (REVALIDATE clamps to 1)
    // while the shopper removes MAIN in the same view. Reconciliation and user
    // mutations are serialized (mutually exclusive, ADR-0007): the reconcile
    // write and the remove write can never race, so removing MAIN must never be
    // resurrected by the background reconcile, and the reconcile's clamp must
    // not be undone.
    const assertMainGone = async () => {
      await expect(page.getByTestId('cart-line').filter({ hasText: CART_SKU_MAIN })).toHaveCount(0);
      const persisted = await cartCookieItems(page);
      expect(persisted.map((line) => line.sku)).toEqual([CART_SKU_REVALIDATE]);
      expect(persisted.find((line) => line.sku === CART_SKU_REVALIDATE)?.qty).toBe(1);
    };

    await page.goto('/en/products/e2e-cart-primary');
    await page.getByTestId('add-to-cart').click();
    await expect(page.getByTestId('cart-count')).toHaveText('1');
    await page.goto('/en/products/e2e-cart-revalidate');
    await page.getByTestId('add-to-cart').click();
    await expect(page.getByTestId('cart-count')).toHaveText('2');
    await page.goto('/en/cart');
    await page.getByTestId(`cart-qty-increase-${CART_SKU_REVALIDATE}`).click();
    await expect(page.getByTestId(`cart-qty-${CART_SKU_REVALIDATE}`)).toHaveText('2');

    try {
      await setVariantInventory(CART_SKU_REVALIDATE, 1);
      await page.reload();
      // This view needs reconciliation: REVALIDATE is clamped to 1 and flagged,
      // while MAIN remains removable. The cart controls park the click until the
      // in-flight reconcile finishes (serialized), so the remove lands on top of
      // the persisted clamp and is never reverted by a racing reconcile write.
      await expect(page.getByTestId(`cart-insufficient-stock-${CART_SKU_REVALIDATE}`)).toBeVisible();
      await expect(page.getByTestId(`cart-qty-${CART_SKU_REVALIDATE}`)).toHaveText('1');
      await page.getByTestId(`cart-remove-${CART_SKU_MAIN}`).click();
      await expect(page.getByTestId('cart-line').filter({ hasText: CART_SKU_MAIN })).toHaveCount(0);
      // The cookie persists the reconcile's clamp AND the user's removal.
      await expect.poll(async () => (await cartCookieItems(page)).map((line) => line.sku)).toEqual([
        CART_SKU_REVALIDATE,
      ]);
      await expect
        .poll(
          async () =>
            (await cartCookieItems(page)).find((line) => line.sku === CART_SKU_REVALIDATE)?.qty ?? 0,
        )
        .toBe(1);

      // Across a reload, neither the removed MAIN nor the old un-clamped
      // quantity resurrects.
      await page.reload();
      await assertMainGone();
    } finally {
      await setProductPublished('e2e-cart-revalidate', true);
      await setVariantInventory(CART_SKU_REVALIDATE, 10);
      await setVariantPrice(CART_SKU_REVALIDATE, 15000);
    }
  });

  test('cross-tab: concurrent additions from two tabs both persist (no lost update)', async ({ page }) => {
    // Tab A and tab B share ONE browser context — the same cookie store, which
    // is exactly the cross-tab cart scenario. Each cart action reads its own
    // request's cookie snapshot and rewrites the WHOLE cookie, so without
    // serialization two tabs adding different SKUs can each start from the
    // same snapshot and the last Set-Cookie silently drops the other addition.
    // Every cart write runs under the storefront-wide lock (`withCartLock`,
    // ADR-0007), so the two round trips are serialized and both survive.
    const pageB = await page.context().newPage();

    // Hold the server-action POSTs open so the two mutations genuinely
    // overlap: the second tab's request is issued (or, with the lock, queued
    // behind the first) before the first response lands. Without the lock this
    // is precisely the ordering that loses one SKU. Non-action traffic passes
    // through untouched.
    let delayedActions = 0;
    await page.context().route('**/*', async (route) => {
      const headers = route.request().headers();
      if (typeof headers['next-action'] === 'string') {
        delayedActions += 1;
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      await route.continue();
    });

    try {
      await page.goto('/en/products/e2e-cart-primary');
      await pageB.goto('/en/products/e2e-cart-longname');

      // Click A, then B while A's (delayed) action is still in flight.
      await page.getByTestId('add-to-cart').click();
      await page.waitForTimeout(150);
      await pageB.getByTestId('add-to-cart').click();

      // Both additions land. After A's write the shared cookie holds MAIN; once
      // B's serialized write merges onto it, both lines are present.
      await expect(page.getByTestId('cart-count')).toHaveText('1');
      await expect(pageB.getByTestId('cart-count')).toHaveText('2');

      // Both cart actions really were held open by the route (they landed
      // through the interception), so the overlap was exercised — with the
      // fix, B's request was additionally queued behind A's by the storefront
      // lock rather than racing it.
      expect(delayedActions).toBeGreaterThanOrEqual(2);

      // Neither addition was lost: the cart re-renders with BOTH SKUs and the
      // persisted cookie holds both lines.
      await page.goto('/en/cart');
      await expect(page.getByTestId('cart-line')).toHaveCount(2);
      await expect(page.getByTestId(`cart-qty-${CART_SKU_MAIN}`)).toHaveText('1');
      await expect(page.getByTestId(`cart-qty-${CART_SKU_LONGNAME}`)).toHaveText('1');
      const persisted = await cartCookieItems(page);
      expect(persisted.map((line) => line.sku).sort()).toEqual(
        [CART_SKU_MAIN, CART_SKU_LONGNAME].sort(),
      );
    } finally {
      await page.context().unroute('**/*');
      await pageB.close();
    }
  });

  test('stock-capped add reports the shortage instead of a false success', async ({ page }) => {
    // A cart that already holds more than the live stock (qty 5) attempts one
    // more add after inventory drops to 2. The add cannot grow the line, so it
    // must surface the localized stock message — never a false "Added" — and
    // must not silently rewrite the cookie down to the clamp.
    const overStock: CartItem = { sku: CART_SKU_REVALIDATE, qty: 5, priceCents: 15000, addedAt: 1 };
    await page.context().addCookies([
      { name: 'shanyin_cart', value: serializeCart([overStock]), url: BASE_URL },
    ]);
    await page.goto('/en/products/e2e-cart-revalidate');
    await expect(page.getByTestId('cart-count')).toHaveText('5');

    try {
      await setVariantInventory(CART_SKU_REVALIDATE, 2);
      await page.reload();
      await page.getByTestId('add-to-cart').click();
      // The button reports the stock shortage; it does not flip to "Added".
      await expect(page.getByTestId('add-to-cart')).toContainText(ADD_INSUFFICIENT_EN);
      await expect(page.getByTestId('add-to-cart')).not.toContainText('Added');
      // No false increment, and no silent clamp-down write from the failed add.
      await expect(page.getByTestId('cart-count')).toHaveText('5');
      expect((await cartCookieItems(page)).find((line) => line.sku === CART_SKU_REVALIDATE)?.qty).toBe(5);
      // The persisted clamp still happens on the cart page (reconciliation).
      await page.goto('/en/cart');
      await expect(page.getByTestId(`cart-insufficient-stock-${CART_SKU_REVALIDATE}`)).toBeVisible();
      await expect(page.getByTestId(`cart-qty-${CART_SKU_REVALIDATE}`)).toHaveText('2');
    } finally {
      await setVariantInventory(CART_SKU_REVALIDATE, 10);
    }
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