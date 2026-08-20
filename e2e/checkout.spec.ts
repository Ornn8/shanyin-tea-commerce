import { expect, test, type Locator } from '@playwright/test';
import { LOCALE_IDS, type LocaleId } from '../src/i18n/registry';
import {
  CHECKOUT_EMAIL,
  CHECKOUT_SKU,
  checkoutInventory,
  cleanupCheckoutE2e,
  disconnectCheckoutE2e,
  seedCheckoutE2e,
} from './helpers/checkout-db';

/**
 * Checkout + secure lookup journeys (Issue #6 acceptance) at desktop (1440×900)
 * and mobile (390×844) widths:
 *
 *  - one complete simulated purchase per locale: product → cart → checkout
 *    (minimum contact + shipping fields, server-validated, localized copy) →
 *    payment page driven by a VERIFIED gateway event (no browser redirect is
 *    payment authority) → confirmation showing the once-only high-entropy
 *    lookup credential → order lookup by that credential → the same order;
 *  - totals/identifiers/order state are stored server-side and never change on
 *    a locale switch (copy changes only);
 *  - a wrong/malformed credential is the uniform, non-enumerable "not found";
 *  - checkout field validation returns localized per-field errors.
 *
 * REDACTION POLICY (acceptance: "secrets and personal test data redacted from
 * artifacts"): every shopper identity is fake (`@example.test`), no checkout,
 * payment, confirmation, or lookup page is ever screenshotted, and it is
 * asserted that the lookup credential never appears in the URL.
 */

const NEXT_LOCALE: Record<LocaleId, LocaleId> = {
  'zh-CN': 'en',
  en: 'ja',
  ja: 'zh-CN',
};

/** Parse a price text into integer cents (locale-tolerant: strips symbols). */
async function centsOf(locator: Locator): Promise<number> {
  const text = (await locator.textContent()) ?? '';
  return parseInt(text.replace(/\D/g, '') || '0', 10);
}

test.describe('checkout — simulated purchase + secure lookup per locale', () => {
  // Each locale buys one unit (¥150.00) with flat shipping (¥12.00) → ¥162.00.
  let purchases = 0;

  test.beforeAll(async () => {
    await seedCheckoutE2e();
  });
  test.afterAll(async () => {
    await cleanupCheckoutE2e();
    await disconnectCheckoutE2e();
  });

  for (const locale of LOCALE_IDS) {
    test(`${locale}: cart → checkout → simulated payment → confirmation → lookup`, async ({ page }) => {
      // 1. Add the default variant from the product page.
      await page.goto(`/${locale}/products/e2e-checkout-primary`);
      await page.getByTestId('add-to-cart').click();
      await expect(page.getByTestId('cart-count')).toHaveText('1');

      // 2. Cart → checkout.
      await page.goto(`/${locale}/cart`);
      await expect(page.getByTestId('cart-checkout')).toBeVisible();
      await page.getByTestId('cart-checkout').click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/checkout$`));

      // 3. The server-owned summary shows the line and totals ahead of purchase.
      await expect(page.getByTestId('checkout-summary-line')).toHaveCount(1);
      await expect(page.getByTestId('checkout-summary-line').first()).toContainText(CHECKOUT_SKU);
      expect(await centsOf(page.getByTestId('checkout-subtotal'))).toBe(15000);
      expect(await centsOf(page.getByTestId('checkout-shipping'))).toBe(1200);
      expect(await centsOf(page.getByTestId('checkout-total'))).toBe(16200);
      // Localized privacy/error copy is present.
      await expect(page.getByTestId('checkout-privacy-note')).toBeVisible();

      // 4. Fill ONLY the minimum contact + shipping fields (fake data).
      await page.getByTestId('checkout-email').fill(CHECKOUT_EMAIL);
      await page.getByTestId('checkout-recipientName').fill('E2E Shopper');
      await page.getByTestId('checkout-addressLine1').fill('1 E2E Lane');
      await page.getByTestId('checkout-city').fill('Hangzhou');
      await page.getByTestId('checkout-region').fill('Zhejiang');
      await page.getByTestId('checkout-postalCode').fill('310000');
      await page.getByTestId('checkout-countryCode').fill('CN');

      // 5. Submit → payment page drives the deterministic simulated gateway;
      //    completion is confirmed by the verified event (never a redirect).
      await page.getByTestId('checkout-submit').click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/checkout/confirmation`), { timeout: 20_000 });
      await expect(page.getByTestId('confirmation-paid')).toBeVisible();

      const orderNumber = (await page.getByTestId('order-order-number').textContent())?.trim() ?? '';
      expect(orderNumber).toMatch(/^SHY-/);
      const credential = (await page.getByTestId('confirmation-credential-value').textContent())?.trim() ?? '';
      expect(credential).toHaveLength(43);
      // The credential is never in the URL (referrer/log-safe).
      expect(new URL(page.url()).pathname.endsWith(`/checkout/confirmation`)).toBe(true);
      expect(page.url()).not.toContain(credential);

      // Cart cookie was cleared by the successful payment (order is the record).
      await expect(page.getByTestId('cart-count')).toHaveCount(0);

      // 6. Exact server-owned totals on the stored order.
      expect(await centsOf(page.getByTestId('order-subtotal'))).toBe(15000);
      expect(await centsOf(page.getByTestId('order-shipping'))).toBe(1200);
      expect(await centsOf(page.getByTestId('order-total'))).toBe(16200);
      await expect(page.getByTestId('order-line').first()).toContainText(CHECKOUT_SKU);

      // 7. Locale switch: copy changes, totals/order number/state never do.
      const next = NEXT_LOCALE[locale];
      await page.selectOption('#locale-picker', next);
      await expect(page).toHaveURL(new RegExp(`/${next}/checkout/confirmation`));
      await expect(page.getByTestId('confirmation-paid')).toBeVisible();
      expect((await page.getByTestId('order-order-number').textContent())?.trim()).toBe(orderNumber);
      expect(await centsOf(page.getByTestId('order-total'))).toBe(16200);
      expect(await centsOf(page.getByTestId('order-subtotal'))).toBe(15000);

      // 8. Secure lookup by credential (pre-filled from sessionStorage) shows
      //    the same order, with personal data only after the credential.
      await page.getByTestId('confirmation-view-order').click();
      await expect(page).toHaveURL(new RegExp(`/${next}/orders/lookup`));
      await expect(page.getByTestId('orders-credential')).toHaveValue(credential);
      await page.getByTestId('orders-lookup-submit').click();
      await expect(page.getByTestId('order-details')).toBeVisible();
      expect((await page.getByTestId('order-order-number').textContent())?.trim()).toBe(orderNumber);
      expect(await centsOf(page.getByTestId('order-total'))).toBe(16200);
      await expect(page.getByTestId('order-shipping-address')).toContainText('E2E Shopper');

      // 9. Stock was decremented exactly once (never double) by the verified
      //    gateway event.
      purchases += 1;
      expect(await checkoutInventory()).toBe(10 - purchases);
    });
  }

  test('lookup rejects unknown / malformed credentials — order existence is not observable', async ({ page }) => {
    await page.goto('/en/orders/lookup');
    await page.getByTestId('orders-credential').fill('k'.repeat(43)); // well-formed but wrong
    await page.getByTestId('orders-lookup-submit').click();
    await expect(page.getByTestId('orders-error')).toBeVisible();
    await expect(page.getByTestId('order-details')).toHaveCount(0);
    // Malformed input takes the same uniform not-found path (no enumeration).
    await page.getByTestId('orders-credential').fill('nope');
    await page.getByTestId('orders-lookup-submit').click();
    await expect(page.getByTestId('orders-error')).toBeVisible();
    await expect(page.getByTestId('order-details')).toHaveCount(0);
  });

  test('checkout validates the minimum fields server-side with localized copy', async ({ page }) => {
    await page.goto('/en/products/e2e-checkout-primary');
    await page.getByTestId('add-to-cart').click();
    await expect(page.getByTestId('cart-count')).toHaveText('1');
    await page.goto('/en/cart');
    await page.getByTestId('cart-checkout').click();

    // Submit empty → per-field required errors in the active locale.
    await page.getByTestId('checkout-submit').click();
    await expect(page.getByTestId('checkout-email-error')).toBeVisible();
    await expect(page.getByTestId('checkout-recipientName-error')).toBeVisible();
    await expect(page.getByTestId('checkout-countryCode-error')).toBeVisible();

    // An invalid email gets its specific message.
    await page.getByTestId('checkout-email').fill('not-an-email');
    await page.getByTestId('checkout-submit').click();
    await expect(page.getByTestId('checkout-email-error')).toContainText('valid email');

    // A cart still in the browser completes normally after a valid fill.
    await page.getByTestId('checkout-email').fill(CHECKOUT_EMAIL);
    await page.getByTestId('checkout-recipientName').fill('E2E Shopper');
    await page.getByTestId('checkout-addressLine1').fill('1 E2E Lane');
    await page.getByTestId('checkout-city').fill('Hangzhou');
    await page.getByTestId('checkout-region').fill('Zhejiang');
    await page.getByTestId('checkout-postalCode').fill('310000');
    await page.getByTestId('checkout-countryCode').fill('CN');
    await page.getByTestId('checkout-submit').click();
    await expect(page).toHaveURL(/\/en\/checkout\/confirmation$/, { timeout: 20_000 });
    await expect(page.getByTestId('confirmation-paid')).toBeVisible();
  });
});
