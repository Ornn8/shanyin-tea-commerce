'use server';

/**
 * Checkout server actions (Issue #6, ADR-0008).
 *
 * Thin wrappers over the order service that own the browser-facing surface:
 * - `createCheckout` validates the contact/shipping form server-side, re-reads
 *   the signed cart as server truth (prices/stock are NEVER client-supplied),
 *   and persists a PENDING order — returning the high-entropy lookup credential
 *   to the shopper. Creation is idempotent per the client submission key: a
 *   replayed submission returns the existing order with the SAME (deterministically
 *   derived) credential, so a lost first response can never lock the shopper
 *   out of an order the database already created.
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
import { createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { CART_COOKIE, CART_MAX_AGE_SECONDS, type CartItem } from '@/lib/cart';
import { parseCart, serializeCart } from '@/lib/cart-signing';
import {
  applyGatewayEvent,
  createOrder,
  findOrderIdentityByCredential,
  getOrderViewById,
  getOrderViewByCredential,
  resolveCheckoutLines,
} from '@/lib/order-service';
import type { OrderView } from '@/lib/order-view';
import { prisma } from '@/lib/prisma';
import { buildSimulatedEvent } from '@/lib/simulated-gateway';
import { estimateShipping } from '@/lib/shipping-estimate';
import {
  validateCheckoutFields,
  normalizeSubmissionKey,
  type CheckoutFieldErrors,
} from '@/lib/checkout-validation';
import { deriveLookupCredential } from '@/lib/order-credentials';
import type { LocaleId } from '@/i18n/registry';

export type CreateCheckoutResult =
  | { ok: true; replay: boolean; checkoutId: string; orderNumber: string; credential?: string; totalCents: number }
  | { ok: false; code: 'empty-cart' | 'out-of-stock' | 'validation' | 'unexpected'; errors?: CheckoutFieldErrors };

export async function createCheckout(formData: FormData): Promise<CreateCheckoutResult> {
  try {
    // 0. The submission idempotency key is REQUIRED (ADR-0008) and MUST be
    //    checked BEFORE cart validation. If the first create response was lost
    //    after the DB insert committed, the cart may now be expired/cleared,
    //    unpublished, or out-of-stock — but the PENDING order and PII already
    //    exist. Recovering the existing submission before cart checks prevents
    //    stranding the order and creating a duplicate (review finding d49e4cb
    //    P1 #2).
    const submissionKey = normalizeSubmissionKey(formData.get('submissionKey'));
    if (!submissionKey) {
      return { ok: false, code: 'unexpected' };
    }
    const existingByKey = await prisma.order.findUnique({
      where: { submissionKey },
      select: { id: true, orderNumber: true, totalCents: true },
    });
    if (existingByKey) {
      const credential = deriveLookupCredential(submissionKey);
      return {
        ok: true,
        replay: true,
        checkoutId: existingByKey.id,
        orderNumber: existingByKey.orderNumber,
        credential,
        totalCents: existingByKey.totalCents,
      };
    }

    // 1. Re-read and VALIDATE the signed cart (server truth). A cart that is
    //    expired, tampered, or empty can never start a NEW checkout (a replay
    //    above already returned).
    const store = await cookies();
    const rawCart = store.get(CART_COOKIE)?.value;
    const state = parseCart(rawCart);
    if (state.status !== 'ok') return { ok: false, code: 'empty-cart' };
    const resolved = await resolveCheckoutLines(state.items);
    if (resolved.lines.length === 0) return { ok: false, code: 'empty-cart' };
    if (resolved.outOfStock) return { ok: false, code: 'out-of-stock' };

    // 1b. Cross-tab idempotency: one cart generation (fingerprint of the
    //     signed cart cookie) maps to at most one open (PENDING/PAID) order.
    //     Two tabs sharing the same cart but generating different
    //     sessionStorage submissionKeys must not create two orders that can both
    //     become PAID when inventory remains. Enforced on the server via the
    //     stored cartFingerprint (review finding d49e4cb P1 #1). The fingerprint
    //     alone is brittle: adding a SKU or changing a quantity changes the
    //     fingerprint while existing lines retain the same addedAt identities, so
    //     a second tab could create another PENDING order with overlapping lines
    //     and both could reach PAID. The stored fingerprint check is kept for the
    //     exact-match fast path, but a fallback via purchased line identity
    //     (OrderLine.sourceAddedAt vs CartItem.addedAt) is required so a cart
    //     mutation does not lose recovery of a PAID order whose response was lost
    //     and whose lines remain in the cart (review finding 8783066 P1 #1).
    const cartFingerprint = createHash('sha256').update(rawCart ?? '').digest('hex').slice(0, 16);
    const existingByFp = await prisma.order.findFirst({
      where: { cartFingerprint, status: { in: ['PENDING', 'PAID'] } },
      select: { id: true, orderNumber: true, submissionKey: true, totalCents: true },
    });
    if (existingByFp) {
      const credential = deriveLookupCredential(existingByFp.submissionKey);
      return {
        ok: true,
        replay: true,
        checkoutId: existingByFp.id,
        orderNumber: existingByFp.orderNumber,
        credential,
        totalCents: existingByFp.totalCents,
      };
    }
    // Fallback: detect any PENDING/PAID order whose purchased line identity
    // overlaps the current cart. If the PAID response carrying cart cleanup was
    // lost, the shopper's cart still holds the purchased generation (same
    // sourceAddedAt); a subsequent checkout with a mutated cart (new SKU or qty)
    // produces a new fingerprint but must not create a duplicate order that
    // would double-decrement overlapping inventory. Matching on sourceAddedAt
    // is generation-exact, unlike a whole-cookie hash.
    if (state.items.length > 0) {
      const cartAddedAts = state.items.map((it) => BigInt(it.addedAt));
      const overlapping = await prisma.order.findFirst({
        where: {
          status: { in: ['PENDING', 'PAID'] },
          lines: { some: { sourceAddedAt: { in: cartAddedAts } } },
        },
        select: { id: true, orderNumber: true, submissionKey: true, totalCents: true },
        orderBy: { createdAt: 'desc' },
      });
      if (overlapping) {
        const credential = deriveLookupCredential(overlapping.submissionKey);
        return {
          ok: true,
          replay: true,
          checkoutId: overlapping.id,
          orderNumber: overlapping.orderNumber,
          credential,
          totalCents: overlapping.totalCents,
        };
      }
    }

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

    // 4. Persist the immutable PENDING order (ADR-0008). Idempotent per
    //    submissionKey AND per cart generation: a replay of the same key OR a
    //    second tab with the same cart fingerprint returns the existing order.
    const created = await createOrder({
      ...validation.values,
      submissionKey,
      cartFingerprint,
      lines: resolved.lines.map((line) => ({
        sku: line.sku,
        variantName: line.variantName,
        quantity: line.quantity,
        priceCents: line.priceCents,
        inventory: line.inventory,
        nameZhCn: line.nameZhCn,
        nameEn: line.nameEn,
        nameJa: line.nameJa,
        addedAt: line.addedAt,
      })),
      subtotalCents: resolved.subtotalCents,
      shippingFeeCents: shipping.feeCents,
      totalCents,
    });

    // A race that hit the partial unique on cartFingerprint (two tabs both
    // passed the pre-check) returns the winning order via createOrder's catch;
    // ensure we return its stored total/credential.
    if (created.replay) {
      const row = await prisma.order.findUnique({ where: { id: created.orderId }, select: { totalCents: true } });
      const storedTotal = row?.totalCents ?? totalCents;
      return {
        ok: true,
        replay: true,
        checkoutId: created.orderId,
        orderNumber: created.orderNumber,
        credential: created.credential,
        totalCents: storedTotal,
      };
    }

    return {
      ok: true,
      replay: created.replay,
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

/** Cookie that records which PAID orders have already cleared their purchased
 * cart lines. The cart cleanup is idempotent: once an order's lines have been
 * removed, revisiting a stale payment page with the SAME credential must never
 * delete a NEW cart item that happens to share the SKU (replay finding
 * d530bb5→f0019aa). The marker is a JSON array of orderIds, kept as a
 * `lax` cookie with the same lifetime as the cart. */
const PAID_CART_CLEANUP_COOKIE = 'shanyin_paid_cleanup';

function parsePaidCleanupMarker(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const decoded = decodeURIComponent(raw);
    const parsed = JSON.parse(decoded);
    if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    // malformed marker → treat as empty and overwrite on next write
  }
  return [];
}

function serializePaidCleanupMarker(ids: string[]): string {
  return encodeURIComponent(JSON.stringify(ids));
}

/**
 * Drive the deterministic simulated gateway for a PENDING order and process its
 * SIGNED event through the replay-safe pipeline. Idempotent: re-invoking with
 * the same credential converges on the order's current status (paid → paid,
 * failed → failed) and can never create a duplicate order or double-decrement
 * stock.
 *
 * WHATEVER path concludes PAID, only the PURCHASED lines are removed from the
 * cart cookie — unrelated SKUs (or a remainder quantity) added in another tab
 * while payment was in flight are preserved. The client MUST hold the shared
 * `withCartLock` (Web Locks, `src/lib/cart-lock.ts`) while invoking this
 * action so the read-modify-write on the single `shanyin_cart` cookie is
 * serialized across tabs: without the lock, response ordering either drops
 * newly added items or resurrects purchased lines from a stale snapshot,
 * allowing a duplicate checkout. The server additionally matches current cart
 * items to the paid order's lines (quantity-aware) so a concurrent cart write
 * cannot be silently overwritten by a blind whole-cookie delete. A re-entrant
 * call after a lost response (whose Set-Cookie never reached the browser)
 * still removes the purchased lines and can never leave them for a duplicate
 * checkout. An idempotent cleanup marker plus the persisted cart line identity
 * (`OrderLine.sourceAddedAt` vs `CartItem.addedAt`, exact match) ensures a
 * later same-SKU purchase is never mistaken for the previous order's line —
 * even when the replacement was created after checkout but before `paidAt`
 * (review finding 4fc6050: the previous `addedAt > paidAt` comparison is
 * replaced by exact identity).
 */
export async function completePayment(credential: string, locale: LocaleId): Promise<CompletePaymentResult> {
  try {
    const identity = await findOrderIdentityByCredential(credential);
    if (!identity) return { ok: false, code: 'not-found' };

    // Resolve the authoritative order view, applying the verified "succeeded"
    // event when the order is still PENDING.
    let order: OrderView;
    if (identity.status === 'PAID') {
      const existing = await getOrderViewById(identity.orderId, locale);
      if (!existing) return { ok: false, code: 'unexpected' };
      order = existing;
    } else if (identity.status !== 'PENDING') {
      const existing = await getOrderViewById(identity.orderId, locale);
      if (!existing) return { ok: false, code: 'unexpected' };
      order = existing;
    } else {
      const wire = buildSimulatedEvent({
        orderId: identity.orderId,
        intentId: identity.providerIntentId,
      });
      await applyGatewayEvent(wire);
      const current = await getOrderViewById(identity.orderId, locale);
      if (!current) return { ok: false, code: 'unexpected' };
      order = current;
    }

    // Any PAID conclusion surgically removes ONLY the purchased lines from the
    // cart — whether payment just committed in this call or had committed
    // before a lost response — so a paid order's lines can never be checked
    // out again, while unrelated SKUs (or a remainder quantity) added
    // concurrently in another tab are preserved. This is the server side of
    // the race fix; the client side serializes the whole round trip through
    // `withCartLock` so the request's cookie snapshot already includes any
    // committed cart mutation. Idempotency across purchase generations: once an
    // order has been cleaned, a fresh cart item that shares the SKU (added
    // after the original payment) must be preserved — enforced by a persistent
    // cleanup marker and by binding to the persisted cart line identity
    // (`OrderLine.sourceAddedAt` vs `CartItem.addedAt`, exact match). The
    // previous `addedAt > paidAt` comparison is removed: a replacement created
    // after checkout but before `paidAt` (new `addedAt` still < `paidAt`) must
    // not be deleted (review finding 4fc6050).
    if (order.status === 'PAID') {
      const store = await cookies();
      const markerRaw = store.get(PAID_CART_CLEANUP_COOKIE)?.value;
      const cleanedIds = parsePaidCleanupMarker(markerRaw);
      if (cleanedIds.includes(order.orderId)) {
        return { ok: true, status: order.status, order, credential };
      }

      const raw = store.get(CART_COOKIE)?.value;
      const cartState = parseCart(raw);
      if (cartState.status === 'ok' && cartState.items.length > 0) {
        // Resolve the exact purchased generation per SKU from the persisted
        // order lines (sourceAddedAt). Falls back to the view's lines when the
        // DB row is unavailable (defensive).
        const purchasedBySku = new Map<string, { qty: number; sourceAddedAt: bigint | number | null }>();
        let persistedLines: Array<{ sku: string; quantity: number; sourceAddedAt: bigint | null }> | null = null;
        try {
          const persisted = await prisma.order.findUnique({
            where: { id: order.orderId },
            select: { lines: { select: { sku: true, quantity: true, sourceAddedAt: true } } },
          });
          persistedLines = persisted?.lines ?? null;
        } catch {
          persistedLines = null;
        }
        if (persistedLines && persistedLines.length > 0) {
          for (const l of persistedLines) {
            const prev = purchasedBySku.get(l.sku);
            if (prev) prev.qty += l.quantity;
            else purchasedBySku.set(l.sku, { qty: l.quantity, sourceAddedAt: l.sourceAddedAt });
          }
        } else {
          for (const line of order.lines) {
            const prev = purchasedBySku.get(line.sku);
            if (prev) prev.qty += line.quantity;
            else purchasedBySku.set(line.sku, { qty: line.quantity, sourceAddedAt: null });
          }
        }

        const hasPurchasedInCart = cartState.items.some((item) => purchasedBySku.has(item.sku));
        if (hasPurchasedInCart) {
          const remaining: CartItem[] = [];
          for (const item of cartState.items) {
            const purchased = purchasedBySku.get(item.sku);
            if (purchased === undefined) {
              remaining.push(item);
              continue;
            }
            // Exact generation match: a cart line whose addedAt does NOT equal
            // the persisted sourceAddedAt is a NEW generation (e.g. remove +
            // re-add after checkout, replacement before payment, or a new
            // purchase after the previous cart was cleared). It must be
            // preserved whole even though the SKU matches and its addedAt is
            // still < paidAt — the paidAt comparison cannot distinguish this
            // (4fc6050).
            const src = purchased.sourceAddedAt;
            if (src !== null && src !== undefined) {
              const srcMs = typeof src === 'bigint' ? Number(src) : Number(src);
              if (Number.isFinite(item.addedAt) && Number.isFinite(srcMs) && item.addedAt !== srcMs) {
                remaining.push(item);
                continue;
              }
            } else {
              // Legacy fallback (orders created before the identity migration):
              // no persisted sourceAddedAt. A line added after order creation
              // is a new generation and must be kept — the old paidAt check
              // failed for pre-payment replacements (addedAt < paidAt but
              // > createdAt). Using createdAt as the generation boundary
              // preserves those replacements for legacy rows.
              const createdAtMs = new Date(order.createdAt).getTime();
              if (Number.isFinite(item.addedAt) && Number.isFinite(createdAtMs) && item.addedAt > createdAtMs) {
                remaining.push(item);
                continue;
              }
            }
            const remainder = item.qty - purchased.qty;
            if (remainder > 0) {
              remaining.push({ ...item, qty: remainder });
            }
            // remainder <= 0 → fully purchased → drop; remainder >0 → keep
            // uncovered qty (concurrent qty add while payment was in flight
            // with same generation).
          }
          const didChange =
            remaining.length !== cartState.items.length ||
            remaining.some((r, i) => r.sku !== cartState.items[i]?.sku || r.qty !== cartState.items[i]?.qty);
          if (didChange) {
            if (remaining.length === 0) {
              store.delete(CART_COOKIE);
            } else {
              store.set(CART_COOKIE, serializeCart(remaining), {
                path: '/',
                maxAge: CART_MAX_AGE_SECONDS,
                sameSite: 'lax',
              });
            }
          }
        }
      }

      // Persist the idempotent marker so ANY later replay with the same PAID
      // order credential — including a stale payment page still holding the
      // old credential after the shopper started a new cart generation — does
      // not re-apply the SKU-based subtraction to new items.
      const nextCleaned = [...new Set([...cleanedIds, order.orderId])].slice(-20);
      store.set(PAID_CART_CLEANUP_COOKIE, serializePaidCleanupMarker(nextCleaned), {
        path: '/',
        maxAge: CART_MAX_AGE_SECONDS,
        sameSite: 'lax',
      });
    }

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
