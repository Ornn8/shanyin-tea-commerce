'use server';

/**
 * Checkout server actions (Issue #6, ADR-0008).
 *
 * Thin wrappers over the order service that own the browser-facing surface:
 * - `createCheckout` validates the contact/shipping form server-side, re-reads
 *   the signed cart as server truth (prices/stock are NEVER client-supplied),
 *   and persists a PENDING order — returning the high-entropy lookup credential
 *   to the shopper exactly once.
 * - `completePayment` drives the deterministic simulated gateway and processes
 *   its SIGNED event through the same replay-safe pipeline as any webhook; a
 *   browser redirect is never payment authority, and completion is idempotent.
 * - `getCheckoutConfirmation` re-validates an order by credential so a
 *   refreshed confirmation page never trusts the last navigation.
 * - `lookupOrder` is the only public read path and requires the credential;
 *   a wrong/missing credential is a uniform "not found" (not enumerable).
 *
 * Errors return plain codes the client maps onto localized copy — the server
 * never formats translated strings and never echoes user input into messages.
 */
import { cookies } from 'next/headers';
import { CART_COOKIE } from '@/lib/cart';
import { parseCart } from '@/lib/cart-signing';
import {
  applyGatewayEvent,
  createOrder,
  findOrderIdentityByCredential,
  getOrderViewById,
  getOrderViewByCredential,
  resolveCheckoutLines,
} from '@/lib/order-service';
import type { OrderView } from '@/lib/order-view';
import { buildSimulatedEvent } from '@/lib/simulated-gateway';
import { estimateShipping } from '@/lib/shipping-estimate';
import {
  validateCheckoutFields,
  type CheckoutFieldErrors,
} from '@/lib/checkout-validation';
import type { LocaleId } from '@/i18n/registry';

export type CreateCheckoutResult =
  | { ok: true; checkoutId: string; orderNumber: string; credential: string; totalCents: number }
  | { ok: false; code: 'empty-cart' | 'out-of-stock' | 'validation' | 'unexpected'; errors?: CheckoutFieldErrors };

export async function createCheckout(formData: FormData): Promise<CreateCheckoutResult> {
  try {
    // 1. Re-read and VALIDATE the signed cart (server truth). A cart that is
    //    expired, tampered, or empty can never start a checkout.
    const store = await cookies();
    const state = parseCart(store.get(CART_COOKIE)?.value);
    if (state.status !== 'ok') return { ok: false, code: 'empty-cart' };
    const resolved = await resolveCheckoutLines(state.items);
    if (resolved.lines.length === 0) return { ok: false, code: 'empty-cart' };
    if (resolved.outOfStock) return { ok: false, code: 'out-of-stock' };

    // 2. Validate the minimum contact + shipping fields server-side.
    const validation = validateCheckoutFields({
      email: formData.get('email'),
      recipientName: formData.get('recipientName'),
      addressLine1: formData.get('addressLine1'),
      city: formData.get('city'),
      region: formData.get('region'),
      postalCode: formData.get('postalCode'),
      countryCode: formData.get('countryCode'),
    });
    if (!validation.ok) {
      return { ok: false, code: 'validation', errors: validation.errors };
    }

    // 3. Totals come from the CURRENT catalog (stale cart price snapshots are
    //    never trusted — server owns totals) plus the deterministic shipping
    //    estimate (ADR-0007).
    const shipping = estimateShipping(resolved.subtotalCents);
    const totalCents = resolved.subtotalCents + shipping.feeCents;

    // 4. Persist the immutable PENDING order (ADR-0008).
    const created = await createOrder({
      ...validation.values,
      lines: resolved.lines.map((line) => ({
        sku: line.sku,
        variantName: line.variantName,
        quantity: line.quantity,
        priceCents: line.priceCents,
        inventory: line.inventory,
        nameZhCn: line.nameZhCn,
        nameEn: line.nameEn,
        nameJa: line.nameJa,
      })),
      subtotalCents: resolved.subtotalCents,
      shippingFeeCents: shipping.feeCents,
      totalCents,
    });

    return {
      ok: true,
      checkoutId: created.orderId,
      orderNumber: created.orderNumber,
      credential: created.credential,
      totalCents,
    };
  } catch (error) {
    console.error('createCheckout failed', error);
    return { ok: false, code: 'unexpected' };
  }
}

export type CompletePaymentResult =
  | { ok: true; status: OrderView['status']; order: OrderView; credential: string }
  | { ok: false; code: 'not-found' | 'unexpected' };

/**
 * Drive the deterministic simulated gateway for a PENDING order and process its
 * SIGNED event through the replay-safe pipeline. Idempotent: re-invoking with
 * the same credential converges on the order's current status (paid → paid,
 * failed → failed) and can never create a duplicate order or double-decrement
 * stock. On success the cart cookie is cleared (the order is now the record).
 */
export async function completePayment(credential: string, locale: LocaleId): Promise<CompletePaymentResult> {
  try {
    const identity = await findOrderIdentityByCredential(credential);
    if (!identity) return { ok: false, code: 'not-found' };

    if (identity.status === 'PAID') {
      const order = await getOrderViewById(identity.orderId, locale);
      return order ? { ok: true, status: order.status, order, credential } : { ok: false, code: 'unexpected' };
    }
    if (identity.status !== 'PENDING') {
      const order = await getOrderViewById(identity.orderId, locale);
      return order ? { ok: true, status: order.status, order, credential } : { ok: false, code: 'unexpected' };
    }

    const wire = buildSimulatedEvent({
      orderId: identity.orderId,
      intentId: identity.providerIntentId,
    });
    const result = await applyGatewayEvent(wire);

    const order = await getOrderViewById(identity.orderId, locale);
    if (!order) return { ok: false, code: 'unexpected' };

    if (result.ok && result.applied && result.reason === 'paid') {
      const store = await cookies();
      store.delete(CART_COOKIE);
      return { ok: true, status: 'PAID', order, credential };
    }

    // Idempotent convergence for any other outcome (already terminal, replay,
    // stock shortage) — report the current authoritative status.
    return { ok: true, status: order.status, order, credential };
  } catch (error) {
    console.error('completePayment failed', error);
    return { ok: false, code: 'unexpected' };
  }
}

export type ConfirmationResult =
  | { ok: true; order: OrderView; credential: string }
  | { ok: false; code: 'not-found' | 'unexpected' };

/** Re-validate by credential on every confirmation render/refresh, so a
 * refreshed page never trusts the last navigation. Echoes the credential for
 * the shopper to keep (it is the only later recovery path). */
export async function getCheckoutConfirmation(credential: string, locale: LocaleId): Promise<ConfirmationResult> {
  try {
    const order = await getOrderViewByCredential(credential, locale);
    if (!order) return { ok: false, code: 'not-found' };
    return { ok: true, order, credential };
  } catch (error) {
    console.error('getCheckoutConfirmation failed', error);
    return { ok: false, code: 'unexpected' };
  }
}

export type LookupOrderResult =
  | { ok: true; order: OrderView }
  | { ok: false; code: 'not-found' | 'unexpected' };

/** The public order read: requires the high-entropy credential. A wrong,
 * missing, or malformed credential is the same uniform "not found" — order
 * existence and personal data are never enumerable. */
export async function lookupOrder(credential: string, locale: LocaleId): Promise<LookupOrderResult> {
  try {
    const order = await getOrderViewByCredential(credential, locale);
    if (!order) return { ok: false, code: 'not-found' };
    return { ok: true, order };
  } catch (error) {
    console.error('lookupOrder failed', error);
    return { ok: false, code: 'unexpected' };
  }
}
