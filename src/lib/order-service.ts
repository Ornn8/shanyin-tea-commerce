/**
 * Order service (Issue #6, ADR-0008) — database-bound, Next.js-free.
 *
 * Owns the pilot checkout path:
 *
 *  - `resolveCheckoutLines` re-validates the signed cart against the live
 *    catalog at checkout time (server owns totals; the cart's price snapshot
 *    is never trusted) and captures per-locale display name snapshots;
 *  - `createOrder` persists an immutable PENDING order (order number,
 *    provider intent, lookup-credential hash only, contact + shipping, and
 *    snapshot order lines) and returns the credential to the shopper.
 *    Creation is IDEMPOTENT per client submission key: replaying the same
 *    submission returns the existing order with the SAME (deterministically
 *    derived) credential, so a lost first create response always recovers;
 *  - `applyGatewayEvent` is the replay-safe payment processor: verify
 *    signature → idempotent apply (unique per-gateway event id, reserved in
 *    the SAME transaction as the atomic stock decrement) → explicit state
 *    machine → exactly-once stock decrement for `succeeded`. Every transition
 *    runs in ONE transaction that locks the order row, so concurrent events
 *    with different ids for the same order can never double-decrement stock or
 *    downgrade a paid order;
 *  - `getOrderViewByCredential` is the only way order data leaves the server:
 *    lookup by the high-entropy credential's hash, never enumerable.
 */
import { prisma } from '@/lib/prisma';
import type { CartItem } from '@/lib/cart';
import { estimateShipping, SHIPPING_FREE_THRESHOLD_CENTS, SHIPPING_FLAT_CENTS } from '@/lib/shipping-estimate';
import {
  orderTransition,
  type OrderStatusId,
} from '@/lib/order-status';
import type { GatewayEventWire } from '@/lib/simulated-gateway';
import { verifyGatewaySignature } from '@/lib/simulated-gateway';
import {
  deriveLookupCredential,
  generateOrderNumber,
  hashLookupCredential,
  newProviderIntentId,
} from '@/lib/order-credentials';
import { toOrderView, type OrderView } from '@/lib/order-view';
import type { LocaleId } from '@/i18n/registry';

/** Signature could not be verified — callers reject the delivery and record
 * nothing (the webhook route returns 400; server actions surface a generic
 * error). */
export class InvalidGatewaySignatureError extends Error {
  constructor(message = 'Payment event signature verification failed.') {
    super(message);
    this.name = 'InvalidGatewaySignatureError';
  }
}

/** Stock shortage detected at payment time (within a transaction). */
class StockShortageError extends Error {
  constructor() {
    super('Insufficient stock at payment time.');
    this.name = 'StockShortageError';
  }
}

/** Defensive: a transition raced a mutation that the per-order lock did not
 * observe (should never happen — the lock makes the read authoritative). */
class ConcurrencyError extends Error {
  constructor(detail: string) {
    super(`Order state changed concurrently during apply: ${detail}`);
    this.name = 'ConcurrencyError';
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';
}

// ---------------------------------------------------------------------------
// Checkout line resolution (server truth at checkout time)
// ---------------------------------------------------------------------------

export interface CheckoutLine {
  sku: string;
  variantName: string;
  /** Effective quantity after revalidation against current inventory. */
  quantity: number;
  /** Live variant price in integer CNY cents (never the cart snapshot). */
  priceCents: number;
  inventory: number;
  /** Display-name snapshots in every registered locale (ADR-0003/0008). */
  nameZhCn: string;
  nameEn: string;
  nameJa: string;
  /** Epoch milliseconds of the originating cart line (CartItem.addedAt). Persists
   * as OrderLine.sourceAddedAt so PAID cleanup can match the exact purchased
   * generation instead of comparing with paidAt (review finding 4fc6050). */
  addedAt: number;
}

export interface ResolvedCheckout {
  lines: CheckoutLine[];
  subtotalCents: number;
  /** True when any cart line's variant is out of stock (checkout rejects). */
  outOfStock: boolean;
}

/**
 * Re-validate the signed cart at checkout time. Unknown/unpublished lines are
 * dropped; quantities are clamped to the current shared inventory; prices come
 * from the VARIANT ROW only (the cart's display snapshot is never trusted).
 * Returns per-locale display-name snapshots so an order's meaning survives
 * later catalog edits.
 */
export async function resolveCheckoutLines(items: CartItem[]): Promise<ResolvedCheckout> {
  const skus = items.map((item) => item.sku);
  if (skus.length === 0) return { lines: [], subtotalCents: 0, outOfStock: false };

  const rows = await prisma.product.findMany({
    where: { published: true, variants: { some: { sku: { in: skus } } } },
    include: {
      localizations: { select: { locale: true, name: true } },
      variants: {
        where: { sku: { in: skus } },
        select: { sku: true, name: true, priceCents: true, inventory: true },
      },
    },
  });

  const bySku = new Map<string, { productName: Record<string, string>; variant: { sku: string; name: string; priceCents: number; inventory: number } }>();
  for (const row of rows) {
    const names: Record<string, string> = {};
    for (const loc of row.localizations) {
      names[loc.locale] = loc.name;
    }
    const enFallback = names.en ?? names['zh-CN'] ?? names.ja ?? '';
    const zhFallback = names['zh-CN'] ?? names.en ?? names.ja ?? '';
    const jaFallback = names.ja ?? names.en ?? names['zh-CN'] ?? '';
    for (const variant of row.variants) {
      bySku.set(variant.sku, {
        productName: {
          en: names.en ?? enFallback,
          'zh-CN': names['zh-CN'] ?? zhFallback,
          ja: names.ja ?? jaFallback,
        },
        variant: { sku: variant.sku, name: variant.name, priceCents: variant.priceCents, inventory: variant.inventory },
      });
    }
  }

  let subtotalCents = 0;
  let outOfStock = false;
  const lines: CheckoutLine[] = [];
  for (const item of items) {
    const resolved = bySku.get(item.sku);
    if (!resolved) continue; // unpublished / unknown → dropped
    if (resolved.variant.inventory <= 0) {
      outOfStock = true;
      continue;
    }
    const quantity = Math.min(item.qty, resolved.variant.inventory);
    if (quantity <= 0) continue;
    const subtotal = quantity * resolved.variant.priceCents;
    lines.push({
      sku: item.sku,
      variantName: resolved.variant.name,
      quantity,
      priceCents: resolved.variant.priceCents,
      inventory: resolved.variant.inventory,
      nameZhCn: resolved.productName['zh-CN'],
      nameEn: resolved.productName.en,
      nameJa: resolved.productName.ja,
      addedAt: item.addedAt,
    });
    subtotalCents += subtotal;
  }
  return { lines, subtotalCents, outOfStock };
}

// ---------------------------------------------------------------------------
// Shipping estimate (same deterministic rule as the cart, ADR-0007)
// ---------------------------------------------------------------------------

export { SHIPPING_FREE_THRESHOLD_CENTS, SHIPPING_FLAT_CENTS, estimateShipping };

// ---------------------------------------------------------------------------
// Order creation
// ---------------------------------------------------------------------------

export interface OrderContact {
  email: string;
  recipientName: string;
  addressLine1: string;
  city: string;
  region: string;
  postalCode: string;
  countryCode: string;
}

export interface CreateOrderInput extends OrderContact {
  lines: CheckoutLine[];
  subtotalCents: number;
  shippingFeeCents: number;
  totalCents: number;
  /** Client-provided submission idempotency key. A replayed submission with the
   * same key returns the existing order instead of creating a duplicate, so a
   * double-submitted or retried checkout can never create multiple PENDING
   * orders (or duplicate personal data) for one checkout (ADR-0008). */
  submissionKey: string;
  /** Fingerprint of the signed cart cookie at checkout time (hash of the cookie,
   * 16 hex chars). Binds an order to its cart generation so two tabs sharing
   * the same cart cannot create two different orders with different submission
   * keys — cross-tab idempotency (review finding d49e4cb P1 #1). Only
   * PENDING/PAID orders contest the fingerprint; a terminal order releases it. */
  cartFingerprint?: string | null;
}

export interface CreatedOrder {
  orderId: string;
  orderNumber: string;
  /** The high-entropy lookup credential. It is DERIVED deterministically from
   * the client submission key, so it is present on first creation AND on every
   * replay of the same submission — the same credential each time — letting a
   * shopper whose first create response was lost recover the order and proceed
   * to payment. Only `sha256(credential)` is stored; the server can never
   * re-issue a random one. */
  credential: string;
  /** True when a submission with this key had ALREADY created the order. */
  replay: boolean;
}

/**
 * Persist a PENDING order and return the high-entropy lookup credential to the
 * shopper. Only `sha256(credential)` is stored — the server cannot recover a
 * random credential later. Totals are integer CNY cents captured from
 * `resolveCheckoutLines` (server truth); nothing here trusts the client.
 *
 * Idempotent: the `submissionKey` is a UNIQUE key on `Order`, so a replayed
 * submission (retry after a network loss, a double-click, a re-submit) returns
 * the EXISTING order (`replay: true`) instead of inserting a duplicate — one
 * checkout submission always means exactly one order. Because the credential is
 * a deterministic function of the submission key (`deriveLookupCredential`),
 * the replay returns the SAME credential, so even a lost first create response
 * never locks the shopper out of the order (review finding #1).
 */
export async function createOrder(input: CreateOrderInput): Promise<CreatedOrder> {
  // Derive (not roll) the lookup credential from the client submission key: the
  // SAME key — including a retry after the first response was lost — always
  // yields the SAME credential, and only its SHA-256 is persisted.
  const credential = deriveLookupCredential(input.submissionKey);
  const lookupHash = hashLookupCredential(credential);
  const orderNumber = generateOrderNumber();
  const providerIntentId = newProviderIntentId('simulated');

  // Cross-tab idempotency: one cart generation maps to at most one open
  // (PENDING/PAID) order. Two tabs sharing the same signed cart cookie have the
  // same cartFingerprint but different submissionKeys; the second must replay the
  // first order instead of creating a duplicate that could also become PAID.
  // Terminal orders (FAILED/EXPIRED/CANCELLED/REFUNDED) release the fingerprint
  // so a retry from the kept cart can create a fresh order.
  const fingerprint = input.cartFingerprint ?? null;
  if (fingerprint) {
    const existingByFingerprint = await prisma.order.findFirst({
      where: { cartFingerprint: fingerprint, status: { in: ['PENDING', 'PAID'] } },
      select: { id: true, orderNumber: true, submissionKey: true },
    });
    if (existingByFingerprint) {
      const existingCredential = deriveLookupCredential(existingByFingerprint.submissionKey);
      return { orderId: existingByFingerprint.id, orderNumber: existingByFingerprint.orderNumber, credential: existingCredential, replay: true };
    }
  }

  // Idempotent replay fast-path: a submission key that already created an order
  // returns it (with the same derived credential) without touching the insert.
  const already = await prisma.order.findUnique({
    where: { submissionKey: input.submissionKey },
    select: { id: true, orderNumber: true },
  });
  if (already) {
    return { orderId: already.id, orderNumber: already.orderNumber, credential, replay: true };
  }

  try {
    const order = await prisma.order.create({
      data: {
        orderNumber,
        status: 'PENDING',
        currency: 'CNY',
        subtotalCents: input.subtotalCents,
        shippingFeeCents: input.shippingFeeCents,
        totalCents: input.totalCents,
        email: input.email,
        recipientName: input.recipientName,
        addressLine1: input.addressLine1,
        city: input.city,
        region: input.region,
        postalCode: input.postalCode,
        countryCode: input.countryCode,
        lookupHash,
        submissionKey: input.submissionKey,
        cartFingerprint: fingerprint,
        gateway: 'simulated',
        providerIntentId,
        lines: {
          create: input.lines.map((line) => ({
            sku: line.sku,
            variantName: line.variantName,
            nameZhCn: line.nameZhCn,
            nameEn: line.nameEn,
            nameJa: line.nameJa,
            unitPriceCents: line.priceCents,
            quantity: line.quantity,
            subtotalCents: line.quantity * line.priceCents,
            currency: 'CNY',
            sourceAddedAt: BigInt(line.addedAt),
          })),
        },
      },
      select: { id: true, orderNumber: true },
    });

    return { orderId: order.id, orderNumber: order.orderNumber, credential, replay: false };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      // A unique collision during creation. The freshly randomized keys
      // (`orderNumber`, `providerIntentId`) cannot realistically collide, so
      // this is an idempotent replay that raced the fast-path read: resolve the
      // existing order by this submission key and return it (with the same
      // derived credential). The partial unique on cartFingerprint (PENDING/PAID)
      // can also race: two tabs with different submissionKeys but same
      // cartFingerprint both pass the fast-path, the second hits the partial
      // unique and must replay the first order (with that order's credential).
      const existing = await prisma.order.findUnique({
        where: { submissionKey: input.submissionKey },
        select: { id: true, orderNumber: true },
      });
      if (existing) {
        return { orderId: existing.id, orderNumber: existing.orderNumber, credential, replay: true };
      }
      if (fingerprint) {
        const existingByFingerprint = await prisma.order.findFirst({
          where: { cartFingerprint: fingerprint, status: { in: ['PENDING', 'PAID'] } },
          select: { id: true, orderNumber: true, submissionKey: true },
        });
        if (existingByFingerprint) {
          const existingCredential = deriveLookupCredential(existingByFingerprint.submissionKey);
          return { orderId: existingByFingerprint.id, orderNumber: existingByFingerprint.orderNumber, credential: existingCredential, replay: true };
        }
      }
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Replay-safe payment event processing
// ---------------------------------------------------------------------------

export type ApplyEventResult =
  | {
      ok: true;
      applied: true;
      reason:
        | 'paid'
        | 'failed'
        | 'expired'
        | 'cancelled'
        | 'refunded'
        | 'stock-shortage';
      orderStatus: OrderStatusId;
      orderId: string;
    }
  | {
      ok: true;
      applied: false;
      reason: 'duplicate' | 'noop' | 'unknown-intent' | 'rejected-signature';
      orderStatus?: OrderStatusId;
    };

function findOrderByIntent(intentId: string) {
  return prisma.order.findUnique({
    where: { providerIntentId: intentId },
    include: { lines: true },
  });
}

function eventRowData(order: { id: string }, wire: GatewayEventWire, resultStatus: OrderStatusId) {
  return {
    orderId: order.id,
    gateway: wire.gateway,
    eventType: wire.payload.type,
    providerEventId: wire.payload.eventId,
    eventCreatedAt: new Date(wire.eventCreatedAtMs),
    signatureVerified: true,
    resultStatus,
  };
}

/** Record a stock-shortage payment failure. Invoked AFTER the apply transaction
 * rolled back (no decrements, no event row), so it runs in its own transaction.
 * It only CONDITIONALLY moves a still-`PENDING` order to `FAILED` — it can never
 * downgrade an order another delivery already paid — and it reserves the event
 * id here (unique per gateway) so the failure is recorded exactly once. */
async function recordStockFailure(order: { id: string }, wire: GatewayEventWire): Promise<ApplyEventResult> {
  try {
    const recordedAs = await prisma.$transaction(async (tx) => {
      // Only a PENDING order may be downgraded by a stock shortage. If a
      // concurrent delivery paid it first, this stays a recorded, non-mutating
      // no-op (defensive — the per-order lock already prevents that ordering).
      const updated = await tx.order.updateMany({
        where: { id: order.id, status: 'PENDING' },
        data: { status: 'FAILED', failureReason: 'out-of-stock' },
      });
      const failureStatus: OrderStatusId = updated.count === 0 ? 'PENDING' : 'FAILED';
      await tx.paymentEvent.create({ data: eventRowData(order, wire, failureStatus) });
      return failureStatus;
    });
    if (recordedAs === 'FAILED') {
      return { ok: true, applied: true, reason: 'stock-shortage', orderStatus: 'FAILED', orderId: order.id };
    }
    // Defensive: the order was no longer PENDING when the failure was recorded —
    // record it against its current status and never mutate state.
    return { ok: true, applied: false, reason: 'noop' };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return { ok: true, applied: false, reason: 'duplicate' };
    }
    throw error;
  }
}

/**
 * Apply ONE verified gateway event (ADR-0008). This is the only place payment
 * state changes and stock is touched:
 *
 *  1. The signature is verified (rejected deliveries throw and record nothing;
 *     a `stripe-test` wire is already boundary-verified).
 *  2. ALL processing for one order runs inside a SINGLE transaction that first
 *     LOCKS the order row (`SELECT … FOR UPDATE`): the state transition is
 *     computed from the locked, CURRENT status. Two concurrent events with
 *     DIFFERENT ids for the same order (e.g. Stripe's
 *     `checkout.session.completed` and `payment_intent.succeeded` both mapping
 *     to `succeeded`) can never both observe `PENDING` — stock is never
 *     double-decremented and a stock shortage can never downgrade an
 *     already-paid order to `FAILED`.
 *  3. The event is applied at most once — the unique `(gateway, providerEventId)`
 *     key is reserved inside the SAME transaction, so a concurrent duplicate
 *     either blocks on the row lock or hits a unique violation and rolls back
 *     its decrements: no order is ever created twice and stock is never
 *     double-decremented.
 *  4. Only the explicit state machine moves `pending` → terminal; a duplicate,
 *     reordered, or contradictory event (e.g. `succeeded` after `failed`) is a
 *     recorded, non-mutating no-op.
 */
export async function applyGatewayEvent(wire: GatewayEventWire): Promise<ApplyEventResult> {
  if (!verifyGatewaySignature(wire)) {
    throw new InvalidGatewaySignatureError();
  }

  // Pre-flight (outside the transaction): resolve and bind the order via its
  // immutable intent id. The transition itself is re-evaluated under the lock.
  const order = await findOrderByIntent(wire.payload.intentId);
  if (!order || order.id !== wire.payload.orderId) {
    return { ok: true, applied: false, reason: 'unknown-intent' };
  }

  // Duplicate fast-path: a fully processed event is never re-applied.
  const existing = await prisma.paymentEvent.findUnique({
    where: {
      gateway_providerEventId: {
        gateway: wire.gateway,
        providerEventId: wire.payload.eventId,
      },
    },
    select: { resultStatus: true },
  });
  if (existing) {
    return { ok: true, applied: false, reason: 'duplicate', orderStatus: existing.resultStatus };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      // Serialize every transition for THIS order: lock the row and compute the
      // state machine from the FRESH status. A second event with a different id
      // waits on the lock, then re-evaluates (e.g. `succeeded` on a now-PAID
      // order is a recorded no-op — no second decrement, no downgrade).
      const locked = await tx.$queryRaw<Array<{ status: string }>>`
        SELECT "status" FROM "Order" WHERE "id" = ${order.id} FOR UPDATE
      `;
      const current = (locked[0]?.status ?? 'PENDING') as OrderStatusId;
      const next = orderTransition(current, wire.payload.type);

      // Reserve the event id under the lock (unique per gateway+event). A
      // concurrent duplicate delivery blocks here, then hits the unique
      // constraint and rolls back every mutation below.
      const reservation = await tx.paymentEvent.create({
        data: eventRowData(order, wire, current),
      });

      if (!next) {
        // Safe no-op (terminal/contradictory/reordered delivery): record against
        // the CURRENT status; never mutate the order, never touch stock.
        return { ok: true, applied: false, reason: 'noop', orderStatus: current } as const;
      }

      if (next === 'PAID') {
        // Atomic conditional stock decrement per line; any shortage rolls
        // EVERYTHING back, including the event reservation.
        for (const line of order.lines) {
          const updated = await tx.productVariant.updateMany({
            where: { sku: line.sku, inventory: { gte: line.quantity } },
            data: { inventory: { decrement: line.quantity } },
          });
          if (updated.count === 0) throw new StockShortageError();
        }
      }

      // Condition the transition on the (locked) expected current status:
      // PENDING→PAID|FAILED|EXPIRED|CANCELLED and PAID→REFUNDED. If a mutation
      // raced a change the locked read did not see, everything rolls back and
      // the delivery is reported as a no-op.
      const transitioned = await tx.order.updateMany({
        where: { id: order.id, status: current },
        data:
          next === 'PAID'
            ? { status: 'PAID', paidAt: new Date() }
            : { status: next, failureReason: next === 'FAILED' ? 'gateway' : null },
      });
      if (transitioned.count === 0) {
        throw new ConcurrencyError(`order ${order.id} state changed during apply (${current} -> ${next})`);
      }

      await tx.paymentEvent.update({
        where: { id: reservation.id },
        data: { resultStatus: next },
      });

      return {
        ok: true,
        applied: true,
        reason: next === 'PAID' ? 'paid' : (next.toLowerCase() as 'failed' | 'expired' | 'cancelled' | 'refunded'),
        orderStatus: next,
        orderId: order.id,
      } as const;
    });
  } catch (error) {
    if (error instanceof StockShortageError) {
      // The whole transaction rolled back (no decrements, no event row); record
      // the failure separately and conditionally (never downgrade a paid order).
      return await recordStockFailure(order, wire);
    }
    if (error instanceof ConcurrencyError) {
      // Defensive: a state change raced a transition the lock did not observe.
      // Roll back and report the delivery as a non-mutating no-op.
      return { ok: true, applied: false, reason: 'noop' };
    }
    if (isUniqueConstraintError(error)) {
      // A concurrent duplicate reserved the event first: it won; this delivery
      // is a safe duplicate (its mutations already rolled back).
      return { ok: true, applied: false, reason: 'duplicate' };
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Customer lookup (credential-only, not enumerable)
// ---------------------------------------------------------------------------

/** Non-secret identity of an order, surfaced only to a credential holder. */
export interface OrderIdentity {
  orderId: string;
  providerIntentId: string;
  orderNumber: string;
  status: string;
}

function wellFormedCredential(credential: string): boolean {
  // Shape check first: only well-formed credentials reach the hash lookup, and
  // a malformed one follows the same not-found path as a wrong one.
  return credential.length <= 64 && /^[A-Za-z0-9_-]+$/.test(credential);
}

/** Resolve an order's identity by the credential the shopper presents. Returns
 * null for a missing or non-matching credential — the same uniform "not found"
 * for any wrong input, so order existence is not observable. */
export async function findOrderIdentityByCredential(
  credential: string | null | undefined,
): Promise<OrderIdentity | null> {
  if (!credential || !wellFormedCredential(credential)) return null;
  const order = await prisma.order.findUnique({
    where: { lookupHash: hashLookupCredential(credential) },
    select: { id: true, providerIntentId: true, orderNumber: true, status: true },
  });
  return order ? { orderId: order.id, providerIntentId: order.providerIntentId, orderNumber: order.orderNumber, status: order.status } : null;
}

/** Resolve an order view by the credential the shopper presents (locale picks
 * the stored display-name snapshot). Uniform null for any wrong input. */
export async function getOrderViewByCredential(
  credential: string | null | undefined,
  locale: LocaleId = 'en',
): Promise<OrderView | null> {
  if (!credential || !wellFormedCredential(credential)) return null;
  const order = await prisma.order.findUnique({
    where: { lookupHash: hashLookupCredential(credential) },
    include: { lines: true },
  });
  return order ? toOrderView(order, locale) : null;
}

export async function getOrderViewById(orderId: string, locale: LocaleId = 'en'): Promise<OrderView | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { lines: true },
  });
  return order ? toOrderView(order, locale) : null;
}

/** Convenience for tests: the event log for an order. */
export async function listOrderEvents(orderId: string) {
  return prisma.paymentEvent.findMany({
    where: { orderId },
    orderBy: { processedAt: 'asc' },
  });
}
