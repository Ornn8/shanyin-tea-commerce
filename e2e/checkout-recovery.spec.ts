import { expect, test } from '@playwright/test';
import {
  RECOVERY_EMAIL,
  RECOVERY_SLUG,
  cartFingerprint,
  cleanupRecoveryE2e,
  disconnectRecoveryE2e,
  seedRecoveryE2e,
  seedRecoveryOrder,
  setRecoveryInventory,
} from './helpers/checkout-recovery-db';

/**
 * Checkout recovery journeys (PR #36 review findings #2 and #3), driven against
 * the real UI with direct-database fixtures:
 *
 *  - finding #2 — a terminal payment failure must RELEASE the submission
 *    idempotency key so the retry (from the kept cart) creates a FRESH order
 *    instead of replaying the terminal one forever;
 *  - finding #3 — re-entering the payment step on an already-PAID order (the
 *    "first response was lost" recovery path) must still clear the purchased
 *    cart lines so they can never be checked out again.
 *
 * REDACTION POLICY is inherited: fake `@example.test` shopper identity, no
 * screenshots of any page that shows the credential or personal data, and every
 * seeded row is removed in teardown.
 */
test.describe('checkout recovery (review findings #2/#3)', () => {
  test.beforeAll(async () => {
    await seedRecoveryE2e();
  });
  test.beforeEach(async () => {
    // The fixtures share one product+SKU; each test starts from a known,
    // in-stock baseline (a previous test's paid retry drains it to zero).
    await setRecoveryInventory(5);
  });
  test.afterAll(async () => {
    await cleanupRecoveryE2e();
    await disconnectRecoveryE2e();
  });

  /** Fill the minimum contact + shipping fields (server-validated). */
  async function fillCheckout(page: import('@playwright/test').Page) {
    await page.getByTestId('checkout-email').fill(RECOVERY_EMAIL);
    await page.getByTestId('checkout-recipientName').fill('Recovery Shopper');
    await page.getByTestId('checkout-addressLine1').fill('1 Recovery Lane');
    await page.getByTestId('checkout-city').fill('Hangzhou');
    await page.getByTestId('checkout-region').fill('Zhejiang');
    await page.getByTestId('checkout-postalCode').fill('310000');
    await page.getByTestId('checkout-countryCode').fill('CN');
  }

  test('a terminal payment failure releases the submission key so retry creates a fresh order', async ({ page }) => {
    // A PENDING order that will fail at payment time (stock drained to zero).
    const seeded = await seedRecoveryOrder({
      status: 'PENDING',
      submissionKey: 'e2e-recovery-submission-1',
      qty: 1,
    });

    // Build a real cart cookie for one unit of the recovery SKU.
    await page.goto(`/en/products/${RECOVERY_SLUG}`);
    await page.getByTestId('add-to-cart').click();
    await expect(page.getByTestId('cart-count')).toHaveText('1');

    // Seed the checkout ticket (every navigation) + the submission key bound to
    // this cart's fingerprint (once, directly — it must NOT be re-seeded later
    // or it would mask the very clear-on-failure behavior this test verifies).
    await page.addInitScript(({ ticket }) => {
      window.sessionStorage.setItem('shanyin_checkout_ticket', JSON.stringify(ticket));
    }, { ticket: { credential: seeded.credential, checkoutId: seeded.orderId, orderNumber: seeded.orderNumber } });
    const cartValue = (await page.context().cookies()).find((c) => c.name === 'shanyin_cart')?.value ?? '';
    await page.evaluate(
      ({ key, fingerprint }) => {
        window.sessionStorage.setItem(
          'shanyin_checkout_submission_key',
          JSON.stringify({ key, cartFingerprint: fingerprint }),
        );
      },
      { key: 'e2e-recovery-submission-1', fingerprint: cartFingerprint(cartValue) },
    );

    // Drain stock so the simulated "succeeded" event hits a shortage → FAILED.
    await setRecoveryInventory(0);

    // Payment step must show the terminal failure (stock shortage).
    await page.goto('/en/checkout/payment');
    await expect(page.getByTestId('payment-failed')).toBeVisible();

    // Finding #2: the submission key was released — a retry can never replay
    // this terminal order.
    const refAfterFailure = await page.evaluate(() => window.sessionStorage.getItem('shanyin_checkout_submission_key'));
    expect(refAfterFailure).toBeNull();

    // Restore a unit, then retry from the kept cart: a FRESH order is created
    // and pays successfully, proving the failure is a deterministic retry path.
    await setRecoveryInventory(1);
    await page.goto('/en/cart');
    await expect(page.getByTestId('cart-checkout')).toBeVisible();
    await page.getByTestId('cart-checkout').click();
    await expect(page.getByTestId('checkout-summary-line')).toHaveCount(1);
    await fillCheckout(page);
    await page.getByTestId('checkout-submit').click();
    await expect(page).toHaveURL(/\/en\/checkout\/confirmation$/, { timeout: 20_000 });
    await expect(page.getByTestId('confirmation-paid')).toBeVisible();

    const newOrderNumber = (await page.getByTestId('order-order-number').textContent())?.trim() ?? '';
    expect(newOrderNumber).toMatch(/^SHY-/);
    expect(newOrderNumber).not.toBe(seeded.orderNumber);
    // The purchased line left the cart.
    await expect(page.getByTestId('cart-count')).toHaveCount(0);
  });

  test('re-entering payment on an already-PAID order still clears the purchased cart lines', async ({ page }) => {
    // Simulate the "first paid response was lost": the order committed PAID,
    // but the browser kept the purchased line in its cart.
    const seeded = await seedRecoveryOrder({
      status: 'PAID',
      submissionKey: 'e2e-recovery-submission-2',
      qty: 1,
    });

    await page.goto(`/en/products/${RECOVERY_SLUG}`);
    await page.getByTestId('add-to-cart').click();
    await expect(page.getByTestId('cart-count')).toHaveText('1');

    // Seed only the ticket; the shopper re-enters the payment step with the
    // order already paid.
    await page.addInitScript(({ ticket }) => {
      window.sessionStorage.setItem('shanyin_checkout_ticket', JSON.stringify(ticket));
    }, { ticket: { credential: seeded.credential, checkoutId: seeded.orderId, orderNumber: seeded.orderNumber } });

    await page.goto('/en/checkout/payment');
    await expect(page.getByTestId('confirmation-paid')).toBeVisible();
    // Finding #3: the purchased line was cleared from the cart.
    await expect(page.getByTestId('cart-count')).toHaveCount(0);
  });
});
