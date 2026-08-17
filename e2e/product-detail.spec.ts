import { expect, test } from '@playwright/test';
import { LOCALE_IDS, type LocaleId } from '../src/i18n/registry';
import {
  cleanupProductDetailE2e,
  disconnectProductDetailE2e,
  seedProductDetailE2e,
} from './helpers/product-detail-db';

/**
 * Product detail journeys (Issue #4 acceptance), at desktop (1440×900) and
 * mobile (390×844) widths:
 *
 *  - variant selection updates SKU, price, stock, media, and add-to-cart
 *    eligibility without losing locale or accessibility state;
 *  - low-stock, unavailable-default, invalid-slug (localized 404), and
 *    locale-switch paths;
 *  - JSON-LD structured data matches the visible price and availability
 *    (initial render and after a variant switch);
 *  - recommendations never expose unpublished products or the current
 *    product; localized image alt text; keyboard radio-group operation;
 *  - no horizontal overflow at either viewport, screenshots for CI.
 */
const NEXT_LOCALE: Record<LocaleId, LocaleId> = {
  'zh-CN': 'en',
  en: 'ja',
  ja: 'zh-CN',
};

const NAMES: Record<LocaleId, { longjing: string; dahongpao: string }> = {
  'zh-CN': { longjing: '西湖龙井 · 明前', dahongpao: '武夷大红袍' },
  en: { longjing: 'Spring Longjing', dahongpao: 'Dahongpao Rock Tea' },
  ja: { longjing: '西湖龍井・明前', dahongpao: '武夷山大紅袍' },
};

const STATUS: Record<LocaleId, { inStock: string; outOfStock: string; lowStock: string; notFoundTitle: string }> = {
  'zh-CN': { inStock: '有货', outOfStock: '缺货', lowStock: '库存紧张', notFoundTitle: '没有找到这款茶' },
  en: { inStock: 'In stock', outOfStock: 'Out of stock', lowStock: 'Low stock', notFoundTitle: 'This tea could not be found' },
  ja: { inStock: '在庫あり', outOfStock: '在庫なし', lowStock: '残りわずか', notFoundTitle: 'この茶葉は見つかりません' },
};

const digits = (value: string | null | undefined) => (value ?? '').replace(/\D/g, '');

function assertNoHorizontalOverflow(page: import('@playwright/test').Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

test.describe('product detail — variant journeys per locale', () => {
  test.beforeAll(async () => {
    await seedProductDetailE2e();
  });
  test.afterAll(async () => {
    await cleanupProductDetailE2e();
    await disconnectProductDetailE2e();
  });

  for (const locale of LOCALE_IDS) {
    test(`${locale}: variant selection updates price, SKU, stock, JSON-LD, and cart`, async ({ page }, testInfo) => {
      // 1. In-stock default: first-created variant (100g) facts visible.
      await page.goto(`/${locale}/products/spring-longjing`);
      await expect(page.getByTestId('product-name')).toHaveText(NAMES[locale].longjing);
      await expect(page.getByTestId('variant-price')).toContainText('1,280');
      await expect(page.getByTestId('variant-sku')).toContainText('SHY-G-001');
      await expect(page.getByTestId('stock-status')).toHaveText(STATUS[locale].inStock);
      await expect(page.getByTestId('add-to-cart')).toBeEnabled();
      await expect(page.getByTestId('variant-options').getByRole('radio')).toHaveCount(3);

      // 2. Initial JSON-LD matches the visible price and availability.
      const initialLd = await page.evaluate(() =>
        JSON.parse(document.getElementById('product-jsonld')!.textContent!),
      );
      expect(initialLd.offers.price).toBe('1280.00');
      expect(initialLd.offers.availability).toBe('https://schema.org/InStock');
      expect(initialLd.offers.sku).toBe('SHY-G-001');
      expect(digits(initialLd.offers.price)).toBe(digits(await page.getByTestId('variant-price').textContent()));

      // 3. Select the 250g variant: price, SKU, stock, JSON-LD update in place.
      const mediaBefore = await page
        .getByRole('img', { name: new RegExp(NAMES[locale].longjing) })
        .evaluate((el) => el.innerHTML);
      await page.getByRole('radio', { name: /250g/ }).check();
      await expect(page.getByTestId('variant-price')).toContainText('3,200');
      await expect(page.getByTestId('variant-sku')).toContainText('SHY-G-001-250');
      await expect(page.getByTestId('stock-status')).toHaveText(STATUS[locale].inStock);
      await expect(page.getByTestId('variant-radio-SHY-G-001-250')).toBeChecked();
      // Media illustration updates per variant (seed `slug:variantId`).
      const mediaAfter = await page
        .getByRole('img', { name: new RegExp(NAMES[locale].longjing) })
        .evaluate((el) => el.innerHTML);
      expect(mediaAfter).not.toBe(mediaBefore);
      const patchedLd = await page.evaluate(() =>
        JSON.parse(document.getElementById('product-jsonld')!.textContent!),
      );
      expect(patchedLd.offers.price).toBe('3200.00');
      expect(patchedLd.offers.availability).toBe('https://schema.org/InStock');
      expect(patchedLd.offers.sku).toBe('SHY-G-001-250');

      // 4. The 50g variant is unavailable: disabled, tagged, never selectable.
      await expect(page.getByTestId('variant-radio-SHY-G-001-50')).toBeDisabled();
      await expect(page.getByTestId('variant-unavailable-SHY-G-001-50')).toBeVisible();

      // 5. Add the selected variant: cart badge, line price, and total match it.
      await page.getByTestId('add-to-cart').click();
      await expect(page.getByTestId('cart-count')).toHaveText('1');
      await page.goto(`/${locale}/cart`);
      await expect(page.getByTestId('cart-items')).toBeVisible();
      await expect(page.getByTestId('cart-line-price')).toContainText('3,200');
      await expect(page.getByTestId('cart-total')).toContainText('3,200');
      await expect(page.getByTestId('cart-items')).toContainText('SHY-G-001-250');

      // 6. Layout at this viewport: no horizontal overflow; screenshot.
      const overflow = await assertNoHorizontalOverflow(page);
      expect(overflow).toBeLessThanOrEqual(1);
      await page.goto(`/${locale}/products/spring-longjing`);
      await expect(page.getByTestId('variant-price')).toBeVisible();
      await page.screenshot({
        path: `e2e/screenshots/${testInfo.project.name}/${locale}-product-detail.png`,
        fullPage: true,
      });
    });

    test(`${locale}: low-stock variant is flagged with the localized notice`, async ({ page }) => {
      await page.goto(`/${locale}/products/dahongpao`);
      await page.getByRole('radio', { name: /250g/ }).check();
      await expect(page.getByTestId('variant-price')).toContainText('4,200');
      await expect(page.getByTestId('stock-status')).toHaveText(STATUS[locale].lowStock);
      // Back to the primary 100g (inventory 12) restores the in-stock state.
      await page.getByRole('radio', { name: /100g/ }).check();
      await expect(page.getByTestId('stock-status')).toHaveText(STATUS[locale].inStock);
      const overflow = await assertNoHorizontalOverflow(page);
      expect(overflow).toBeLessThanOrEqual(1);
    });

    test(`${locale}: unavailable default variant and invalid slug (localized 404)`, async ({ page }) => {
      // Unavailable default: add-to-cart disabled; the in-stock alternative restores it.
      await page.goto(`/${locale}/products/e2e-product-unavailable`);
      await expect(page.getByTestId('stock-status')).toHaveText(STATUS[locale].outOfStock);
      await expect(page.getByTestId('add-to-cart')).toBeDisabled();
      await expect(page.getByTestId('variant-radio-E2E-PRD-001')).toBeDisabled();
      // JSON-LD mirrors the unavailable default before switching.
      const ld = await page.evaluate(() =>
        JSON.parse(document.getElementById('product-jsonld')!.textContent!),
      );
      expect(ld.offers.availability).toBe('https://schema.org/OutOfStock');
      // The in-stock alternative restores the purchase area (and the schema).
      await page.getByRole('radio', { name: /100g/ }).check();
      await expect(page.getByTestId('stock-status')).toHaveText(STATUS[locale].inStock);
      await expect(page.getByTestId('add-to-cart')).toBeEnabled();
      const patched = await page.evaluate(() =>
        JSON.parse(document.getElementById('product-jsonld')!.textContent!),
      );
      expect(patched.offers.availability).toBe('https://schema.org/InStock');

      // Invalid slug: localized not-found empty state, no horizontal overflow.
      await page.goto(`/${locale}/products/does-not-exist`);
      await expect(page.getByTestId('not-found-title')).toHaveText(STATUS[locale].notFoundTitle);
      await expect(page.getByTestId('not-found')).toBeVisible();
      const overflow = await assertNoHorizontalOverflow(page);
      expect(overflow).toBeLessThanOrEqual(1);
    });

    test(`${locale}: locale switch keeps product identity, canonical links, and localized copy`, async ({ page }) => {
      await page.goto(`/${locale}/products/spring-longjing`);
      const identity = await page.getByTestId('product-name').locator('xpath=ancestor::*[@data-product-id][1]');
      const productId = await identity.getAttribute('data-product-id');
      expect(productId).toBeTruthy();

      // Canonical + alternate-language links (ADR-0006).
      const hreflangs = await page.locator('link[rel="alternate"][hreflang]').count();
      expect(hreflangs).toBeGreaterThanOrEqual(3);
      const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
      expect(canonical).toMatch(new RegExp(`/${locale}/products/spring-longjing$`));

      // Switch locale: same language-neutral identity, localized name.
      const next = NEXT_LOCALE[locale];
      await page.selectOption('#locale-picker', next);
      await expect(page).toHaveURL(new RegExp(`/${next}/products/spring-longjing$`));
      await expect(page.getByTestId('product-name')).toHaveText(NAMES[next].longjing);
      const nextIdentity = await page.getByTestId('product-name').locator('xpath=ancestor::*[@data-product-id][1]');
      expect(await nextIdentity.getAttribute('data-product-id')).toBe(productId);
    });

    test(`${locale}: keyboard radio-group operation and localized alt text`, async ({ page }) => {
      await page.goto(`/${locale}/products/spring-longjing`);

      // The variant group is a native radio group: arrow keys move selection,
      // focus stays on the control, and the status region announces changes.
      await page.getByTestId('variant-radio-SHY-G-001').focus();
      await expect(page.getByTestId('variant-radio-SHY-G-001')).toBeFocused();
      await page.keyboard.press('ArrowRight');
      await expect(page.getByTestId('variant-radio-SHY-G-001-250')).toBeChecked();
      await expect(page.getByTestId('variant-radio-SHY-G-001-250')).toBeFocused();
      await expect(page.getByTestId('variant-sku')).toContainText('SHY-G-001-250');
      await expect(page.getByTestId('purchase-status')).toContainText('250g');
      await page.keyboard.press('ArrowLeft');
      await expect(page.getByTestId('variant-radio-SHY-G-001')).toBeChecked();
      await expect(page.getByTestId('variant-sku')).toContainText('SHY-G-001');

      // Localized image alt text on the product media.
      const media = page.getByRole('img', { name: new RegExp(NAMES[locale].longjing) });
      await expect(media).toBeVisible();
    });

    test(`${locale}: recommendations exclude the current and unpublished products`, async ({ page }) => {
      await page.goto(`/${locale}/products/spring-longjing`);
      await expect(page.getByTestId('recommendations')).toBeVisible();
      const links = await page
        .getByTestId('recommendations')
        .getByTestId('product-card')
        .evaluateAll((cards) => cards.map((card) => card.getAttribute('href')));
      expect(links.length).toBeGreaterThan(0);
      for (const href of links) {
        expect(href).not.toContain('spring-longjing');
        expect(href).not.toContain('e2e-product-unpublished');
        expect(href).toContain('/products/');
      }
      // The unpublished fixture is never reachable through a storefront URL.
      await page.goto(`/${locale}/products/e2e-product-unpublished`);
      await expect(page.getByTestId('not-found-title')).toBeVisible();
    });
  }
});