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
 *    snapshot order lines) and returns the credential to the shopper once;
 *  - `applyGatewayEvent` is the replay-safe payment processor: verify
 *    signature → idempotent apply (unique per-gateway event id, reserved in
 *    the SAME transaction as the atomic stock decrement) → explicit state
 *    machine → exactly-once stock decrement for `succeeded`;
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
  generateLookupCredential,
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
}

export interface CreatedOrder {
  orderId: string;
  orderNumber: string;
  credential: string;
}

/**
 * Persist a PENDING order and return the high-entropy lookup credential to the
 * shopper (exactly once). Only `sha256(credential)` is stored — the server
 * cannot recover the credential later. Totals are integer CNY cents captured
 * from `resolveCheckoutLines` (server truth); nothing here trusts the client.
 */
export async function createOrder(input: CreateOrderInput): Promise<CreatedOrder> {
  const credential = generateLookupCredential();
  const lookupHash = hashLookupCredential(credential);
  const orderNumber = generateOrderNumber();
  const providerIntentId = newProviderIntentId('simulated');

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
        })),
      },
    },
    select: { id: true, orderNumber: true },
  });

  return { orderId: order.id, orderNumber: order.orderNumber, credential };
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

/** Record a stock-shortage payment failure (its own transaction; the original
 * apply transaction rolled back all decrements). */
async function recordStockFailure(order: { id: string }, wire: GatewayEventWire): Promise<ApplyEventResult> {
  try {
    await prisma.$transaction([
      prisma.order.update({
        where: { id: order.id },
        data: { status: 'FAILED', failureReason: 'out-of-stock' },
      }),
      prisma.paymentEvent.create({
        data: eventRowData(order, wire, 'FAILED'),
      }),
    ]);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return { ok: true, applied: false, reason: 'duplicate' };
    }
    throw error;
  }
  return { ok: true, applied: true, reason: 'stock-shortage', orderStatus: 'FAILED', orderId: order.id };
}

/**
 * Apply ONE verified gateway event (ADR-0008). This is the only place payment
 * state changes and stock is touched:
 *
 *  1. The signature is verified (rejected deliveries throw and record nothing;
 *     a `stripe-test` wire is already boundary-verified).
 *  2. The event is applied at most once — the unique `(gateway, providerEventId)`
 *     key is RESERVED inside the SAME transaction as the atomic stock
 *     decrement, so a concurrent duplicate either blocks on the reservation or
 *     hits a unique violation and rolls back its decrements: no order can be
 *     created twice and stock can never be double-decremented.
 *  3. Only the explicit state machine moves `pending` → terminal; a duplicate,
 *     reordered, or contradictory event (e.g. `succeeded` after `failed`) is a
 *     recorded, non-mutating no-op.
 */
export async function applyGatewayEvent(wire: GatewayEventWire): Promise<ApplyEventResult> {
  if (!verifyGatewaySignature(wire)) {
    throw new InvalidGatewaySignatureError();
  }
  const order = await findOrderByIntent(wire.payload.intentId);
  if (!order || order.id !== wire.payload.orderId) {
    return { ok: true, applied: false, reason: 'unknown-intent' };
  }

  const current = order.status as OrderStatusId;
  const next = orderTransition(current, wire.payload.type);

  // Duplicate fast-path: already processed → never re-applied.
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

  if (!next) {
    // Safe no-op (terminal/contradictory/reordered delivery): record with the
    // CURRENT status, never mutate the order, never touch stock.
    try {
      await prisma.paymentEvent.create({ data: eventRowData(order, wire, current) });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return { ok: true, applied: false, reason: 'duplicate', orderStatus: current };
      }
      throw error;
    }
    return { ok: true, applied: false, reason: 'noop', orderStatus: current };
  }

  if (next === 'PAID') {
    // One transaction: reserve the event id (serializes concurrent delivery),
    // decrement stock atomically (any shortage rolls EVERYTHING back), mark
    // paid, finalize the event status.
    try {
      await prisma.$transaction(async (tx) => {
        const reservation = await tx.paymentEvent.create({
          data: eventRowData(order, wire, current),
        });
        for (const line of order.lines) {
          const updated = await tx.productVariant.updateMany({
            where: { sku: line.sku, inventory: { gte: line.quantity } },
            data: { inventory: { decrement: line.quantity } },
          });
          if (updated.count === 0) throw new StockShortageError();
        }
        await tx.order.update({
          where: { id: order.id },
          data: { status: 'PAID', paidAt: new Date() },
        });
        await tx.paymentEvent.update({
          where: { id: reservation.id },
          data: { resultStatus: 'PAID' },
        });
      });
    } catch (error) {
      if (error instanceof StockShortageError) {
        // The whole transaction rolled back (no decrements, no event row);
        // record the failure separately.
        return await recordStockFailure(order, wire);
      }
      if (isUniqueConstraintError(error)) {
        // A concurrent duplicate reserved the event first: it won; this
        // delivery is a safe duplicate (its decrements already rolled back).
        return { ok: true, applied: false, reason: 'duplicate' };
      }
      throw error;
    }
    return { ok: true, applied: true, reason: 'paid', orderStatus: 'PAID', orderId: order.id };
  }

  // FAILED / EXPIRED / CANCELLED / REFUNDED — no stock mutation.
  try {
    await prisma.$transaction([
      prisma.order.update({
        where: { id: order.id },
        data: {
          status: next,
          failureReason: next === 'FAILED' ? 'gateway' : null,
        },
      }),
      prisma.paymentEvent.create({ data: eventRowData(order, wire, next) }),
    ]);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return { ok: true, applied: false, reason: 'duplicate' };
    }
    throw error;
  }
  return {
    ok: true,
    applied: true,
    reason: next.toLowerCase() as 'failed' | 'expired' | 'cancelled' | 'refunded',
    orderStatus: next,
    orderId: order.id,
  };
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
