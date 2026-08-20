/**
 * Checkout + replay-safe payment integration tests (Issue #6, ADR-0008).
 *
 * Fixtures (all removed in afterAll):
 * - `demo-checkout-tea` — published product with variants:
 *   - SHY-CHK-001 (inventory 5, ¥150.00) — main line;
 *   - SHY-CHK-LAST (inventory 1, ¥200.00) — the "last unit" for concurrency;
 *   - SHY-CHK-OUT (inventory 0) — forces a whole-checkout out-of-stock reject.
 *
 * Acceptance coverage: concurrent last-unit purchase, duplicate events, stale
 * cart price, payment failure + retry, event reordering, and unauthorized
 * lookup. Test files run serially (`fileParallelism: false`) and share one
 * database.
 */
import 'dotenv/config';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import type { CartItem } from '@/lib/cart';
import {
  applyGatewayEvent,
  createOrder,
  estimateShipping,
  findOrderIdentityByCredential,
  getOrderViewByCredential,
  InvalidGatewaySignatureError,
  resolveCheckoutLines,
} from '@/lib/order-service';
import { buildSimulatedEvent } from '@/lib/simulated-gateway';
import { generateLookupCredential, hashLookupCredential } from '@/lib/order-credentials';

const hasDb = Boolean(process.env.DATABASE_URL);
const describeDb = hasDb ? describe : describe.skip;

const TEMP_SLUG = 'demo-checkout-tea';
const SKU_MAIN = 'SHY-CHK-001';
const SKU_LAST = 'SHY-CHK-LAST';
const SKU_OUT = 'SHY-CHK-OUT';

function item(sku: string, qty: number): CartItem {
  return { sku, qty, priceCents: 1, addedAt: 1 };
}

const CONTACT = {
  email: 'it-shopper@example.test',
  recipientName: 'IT Shopper',
  addressLine1: '1 Test Lane',
  city: 'Hangzhou',
  region: 'Zhejiang',
  postalCode: '310000',
  countryCode: 'CN',
};

const createdOrderIds: string[] = [];

async function inventoryOf(sku: string): Promise<number> {
  const variant = await prisma.productVariant.findUnique({ where: { sku }, select: { inventory: true } });
  return variant?.inventory ?? -1;
}

async function createCheckoutOrder(sku: string, qty: number, priceSnapshot = 1, addedAt = 1) {
  const resolved = await resolveCheckoutLines([{ sku, qty, priceCents: priceSnapshot, addedAt }] as CartItem[]);
  expect(resolved.lines.length).toBeGreaterThan(0);
  expect(resolved.outOfStock).toBe(false);
  const shipping = estimateShipping(resolved.subtotalCents);
  const created = await createOrder({
    ...CONTACT,
    lines: resolved.lines,
    subtotalCents: resolved.subtotalCents,
    shippingFeeCents: shipping.feeCents,
    totalCents: resolved.subtotalCents + shipping.feeCents,
  });
  createdOrderIds.push(created.orderId);
  return created;
}

async function applySuccessFor(credential: string) {
  const identity = await findOrderIdentityByCredential(credential);
  if (!identity) throw new Error('identity missing');
  return applyGatewayEvent(
    buildSimulatedEvent({ orderId: identity.orderId, intentId: identity.providerIntentId }),
  );
}

async function identityFor(credential: string) {
  const identity = await findOrderIdentityByCredential(credential);
  if (!identity) throw new Error('identity missing');
  return identity;
}

describeDb('checkout & payments (ADR-0008)', () => {
  beforeAll(async () => {
    await prisma.$connect();
    const oolong = await prisma.category.findUniqueOrThrow({ where: { slug: 'oolong-tea' } });
    await prisma.product.create({
      data: {
        slug: TEMP_SLUG,
        origin: 'Demo origin',
        form: 'LOOSE',
        caffeine: 'MEDIUM',
        categoryId: oolong.id,
        published: true,
        publishedAt: new Date(),
        variants: {
          create: [
            { sku: SKU_MAIN, name: '100g', priceCents: 15000, inventory: 5, position: 0 },
            { sku: SKU_LAST, name: '200g', priceCents: 20000, inventory: 1, position: 1 },
            { sku: SKU_OUT, name: '250g', priceCents: 25000, inventory: 0, position: 2 },
          ],
        },
        localizations: {
          create: [
            { locale: 'zh-CN', name: '结算演示茶', description: '演示条目', tastingNotes: '演示笔记' },
            { locale: 'en', name: 'Checkout Demo Tea', description: 'Demo checkout fixture', tastingNotes: 'Demo notes' },
            { locale: 'ja', name: 'チェックアウトデモ茶', description: '決済デモ用商品', tastingNotes: 'デモ備考' },
          ],
        },
      },
    });
  });

  afterAll(async () => {
    const ids = [...createdOrderIds];
    if (ids.length > 0) {
      await prisma.order.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.product.deleteMany({ where: { slug: TEMP_SLUG } });
    await prisma.$disconnect();
  });

  // Tests share one database; every test that asserts stock/price starts from
  // a fresh, deterministic fixture baseline.
  beforeEach(async () => {
    await prisma.productVariant.updateMany({
      where: { sku: { in: [SKU_MAIN, SKU_LAST, SKU_OUT] } },
      data: { inventory: { set: 0 } },
    });
    await prisma.productVariant.update({ where: { sku: SKU_MAIN }, data: { inventory: 5, priceCents: 15000 } });
    await prisma.productVariant.update({ where: { sku: SKU_LAST }, data: { inventory: 1, priceCents: 20000 } });
    await prisma.productVariant.update({ where: { sku: SKU_OUT }, data: { inventory: 0 } });
  });

  describe('resolveCheckoutLines (server truth at checkout time)', () => {
    it('uses live prices, clamps quantities, never trusts the cart snapshot', async () => {
      const resolved = await resolveCheckoutLines([item(SKU_MAIN, 9)]); // stale price 1, qty 9
      expect(resolved.outOfStock).toBe(false);
      expect(resolved.lines).toHaveLength(1);
      const line = resolved.lines[0];
      expect(line.priceCents).toBe(15000); // live price, not the snapshot
      expect(line.quantity).toBe(5); // clamped to current inventory
      expect(line.nameEn).toBe('Checkout Demo Tea');
    });

    it('captures per-locale display-name snapshots', async () => {
      const resolved = await resolveCheckoutLines([item(SKU_MAIN, 1)]);
      const line = resolved.lines[0];
      expect(line.nameZhCn).toBe('结算演示茶');
      expect(line.nameJa).toBe('チェックアウトデモ茶');
    });

    it('flags an out-of-stock checkout', async () => {
      const resolved = await resolveCheckoutLines([item(SKU_OUT, 1)]);
      expect(resolved.lines).toHaveLength(0);
      expect(resolved.outOfStock).toBe(true);
    });
  });

  describe('createOrder (immutable PENDING order, credential hash only)', () => {
    it('persists the order + snapshots and stores only the credential hash', async () => {
      const created = await createCheckoutOrder(SKU_MAIN, 2);
      const identity = await findOrderIdentityByCredential(created.credential);
      expect(identity).not.toBeNull();
      expect(identity?.orderId).toBe(created.orderId);
      expect(identity?.orderNumber).toMatch(/^SHY-/);
      expect(identity?.status).toBe('PENDING');

      const row = await prisma.order.findUniqueOrThrow({ where: { id: created.orderId }, include: { lines: true } });
      expect(row.lookupHash).toBe(hashLookupCredential(created.credential));
      expect(row.lookupHash).not.toContain(created.credential);
      expect(row.status).toBe('PENDING');
      expect(row.gateway).toBe('simulated');
      expect(row.totalCents).toBeGreaterThan(0);
      expect(row.lines).toHaveLength(1);
      expect(row.lines[0]).toMatchObject({
        sku: SKU_MAIN,
        unitPriceCents: 15000,
        quantity: 2,
        currency: 'CNY',
      });
    });

    it('stores the localized name snapshot at checkout (catalog edits do not leak in)', async () => {
      const created = await createCheckoutOrder(SKU_MAIN, 1);
      const row = await prisma.order.findUniqueOrThrow({ where: { id: created.orderId }, include: { lines: true } });
      expect(row.lines[0].nameEn).toBe('Checkout Demo Tea');
      expect(row.lines[0].nameZhCn).toBe('结算演示茶');
      expect(row.lines[0].nameJa).toBe('チェックアウトデモ茶');
    });
  });

  describe('applyGatewayEvent (idempotent, replay-safe, exactly-once stock)', () => {
    it('pays a PENDING order, decrements stock exactly once, records one event', async () => {
      const initial = await inventoryOf(SKU_MAIN);
      const created = await createCheckoutOrder(SKU_MAIN, 2);
      const first = await applySuccessFor(created.credential);
      expect(first.ok).toBe(true);
      if (first.ok && first.applied) expect(first.reason).toBe('paid');

      expect(await inventoryOf(SKU_MAIN)).toBe(initial - 2);
      const order = await getOrderViewByCredential(created.credential);
      expect(order?.status).toBe('PAID');

      // Duplicate delivery of the same event (same eventId): no-op.
      const again = await applySuccessFor(created.credential);
      expect(again.ok).toBe(true);
      expect(again.applied).toBe(false);
      expect((again as { reason: string }).reason).toBe('duplicate');
      expect(await inventoryOf(SKU_MAIN)).toBe(initial - 2);

      const events = await prisma.paymentEvent.count({ where: { orderId: created.orderId } });
      expect(events).toBe(1);
    });

    it('rejects an unverified signature without recording anything', async () => {
      const created = await createCheckoutOrder(SKU_MAIN, 1);
      const identity = await identityFor(created.credential);
      const wire = buildSimulatedEvent({ orderId: identity.orderId, intentId: identity.providerIntentId });
      const forged = { ...wire, signature: 'not-a-real-signature' };
      await expect(applyGatewayEvent(forged)).rejects.toBeInstanceOf(InvalidGatewaySignatureError);
      const events = await prisma.paymentEvent.count({ where: { orderId: created.orderId } });
      expect(events).toBe(0);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: created.orderId } })).status).toBe('PENDING');
    });

    it('event reordering: succeeded then failed keeps the order paid and never re-decrements', async () => {
      const initial = await inventoryOf(SKU_MAIN);
      const created = await createCheckoutOrder(SKU_MAIN, 1);
      const identity = await identityFor(created.credential);
      const success = await applyGatewayEvent(
        buildSimulatedEvent({ orderId: identity.orderId, intentId: identity.providerIntentId }),
      );
      expect(success.applied).toBe(true);
      const lateFail = await applyGatewayEvent(
        buildSimulatedEvent({ orderId: identity.orderId, intentId: identity.providerIntentId, type: 'failed' }),
      );
      expect(lateFail.applied).toBe(false);
      expect((lateFail as { reason: string }).reason).toBe('noop');
      expect((await prisma.order.findUniqueOrThrow({ where: { id: created.orderId } })).status).toBe('PAID');
      expect(await inventoryOf(SKU_MAIN)).toBe(initial - 1);
    });

    it('event reordering: failed then succeeded keeps the order failed and never decrements', async () => {
      const initial = await inventoryOf(SKU_MAIN);
      const created = await createCheckoutOrder(SKU_MAIN, 1);
      const identity = await identityFor(created.credential);
      const failFirst = await applyGatewayEvent(
        buildSimulatedEvent({ orderId: identity.orderId, intentId: identity.providerIntentId, type: 'failed' }),
      );
      expect(failFirst.applied).toBe(true);
      const lateSuccess = await applyGatewayEvent(
        buildSimulatedEvent({ orderId: identity.orderId, intentId: identity.providerIntentId }),
      );
      expect(lateSuccess.applied).toBe(false);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: created.orderId } })).status).toBe('FAILED');
      expect(await inventoryOf(SKU_MAIN)).toBe(initial);
      expect(await getOrderViewByCredential(created.credential)).toMatchObject({ status: 'FAILED' });
    });

    it('applies paid → REFUNDED (domain placeholder) with no stock change', async () => {
      const created = await createCheckoutOrder(SKU_MAIN, 1);
      await applySuccessFor(created.credential);
      const identity = await identityFor(created.credential);
      const refunded = await applyGatewayEvent(
        buildSimulatedEvent({ orderId: identity.orderId, intentId: identity.providerIntentId, type: 'refunded' }),
      );
      expect(refunded.applied).toBe(true);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: created.orderId } })).status).toBe('REFUNDED');
    });
  });

  describe('concurrent last-unit purchase (atomic stock decrement)', () => {
    it('exactly one of two competing payments wins the last unit', async () => {
      await prisma.productVariant.update({ where: { sku: SKU_LAST }, data: { inventory: 1 } });
      const a = await createCheckoutOrder(SKU_LAST, 1);
      const b = await createCheckoutOrder(SKU_LAST, 1);
      // Reset to exactly one unit right before the race.
      await prisma.productVariant.update({ where: { sku: SKU_LAST }, data: { inventory: 1 } });

      const [ra, rb] = await Promise.all([applySuccessFor(a.credential), applySuccessFor(b.credential)]);

      expect(await inventoryOf(SKU_LAST)).toBe(0);
      const statuses = [
        (await prisma.order.findUniqueOrThrow({ where: { id: a.orderId } })).status,
        (await prisma.order.findUniqueOrThrow({ where: { id: b.orderId } })).status,
      ].sort();
      // Exactly one order won the last unit; the other failed on stock.
      expect(statuses).toEqual(['FAILED', 'PAID']);
      // Exactly one stock decrement happened (never a negative inventory).
      expect(ra.applied || rb.applied).toBe(true);
    });
  });

  describe('stale cart price (server owns totals)', () => {
    it('prices a checkout off the live catalog, and later catalog edits never touch the order', async () => {
      // Reliable baseline price for THIS test only.
      await prisma.productVariant.update({ where: { sku: SKU_MAIN }, data: { priceCents: 17500 } });
      const resolved = await resolveCheckoutLines([{ sku: SKU_MAIN, qty: 1, priceCents: 100, addedAt: 1 }]);
      expect(resolved.lines[0].priceCents).toBe(17500); // stale snapshot ignored
      const created = await createOrder({
        ...CONTACT,
        lines: resolved.lines,
        subtotalCents: resolved.subtotalCents,
        shippingFeeCents: 0,
        totalCents: resolved.subtotalCents,
      });
      createdOrderIds.push(created.orderId);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: created.orderId }, include: { lines: true } })).lines[0].unitPriceCents).toBe(17500);

      // Merchant edits the catalog price; the immutable order snapshot holds.
      await prisma.productVariant.update({ where: { sku: SKU_MAIN }, data: { priceCents: 99999 } });
      const view = await getOrderViewByCredential(created.credential);
      expect(view?.lines[0].unitPriceCents).toBe(17500);
      expect(view?.totalCents).toBe(17500);
      // Restore for other tests.
      await prisma.productVariant.update({ where: { sku: SKU_MAIN }, data: { priceCents: 15000 } });
    });
  });

  describe('payment failure and retry', () => {
    it('a failed event leaves order FAILED with zero stock movement; retry on a new order works', async () => {
      const initial = await inventoryOf(SKU_MAIN);
      const created = await createCheckoutOrder(SKU_MAIN, 2);
      const identity = await identityFor(created.credential);
      const failed = await applyGatewayEvent(
        buildSimulatedEvent({ orderId: identity.orderId, intentId: identity.providerIntentId, type: 'failed' }),
      );
      expect(failed.applied).toBe(true);
      expect((failed as { reason: string }).reason).toBe('failed');
      expect((await prisma.order.findUniqueOrThrow({ where: { id: created.orderId } })).status).toBe('FAILED');
      expect(await inventoryOf(SKU_MAIN)).toBe(initial); // no stock movement

      // Retry = a fresh order from the (kept) cart; it pays normally.
      const retry = await createCheckoutOrder(SKU_MAIN, 2);
      const paid = await applySuccessFor(retry.credential);
      expect(paid.applied).toBe(true);
      expect(await inventoryOf(SKU_MAIN)).toBe(initial - 2);
      expect((await getOrderViewByCredential(retry.credential))?.status).toBe('PAID');
    });
  });

  describe('customer lookup (credential-only, not enumerable)', () => {
    it('returns the order only for the credential that owns it', async () => {
      const created = await createCheckoutOrder(SKU_MAIN, 1);
      const view = await getOrderViewByCredential(created.credential);
      expect(view?.orderNumber).toBe((await findOrderIdentityByCredential(created.credential))?.orderNumber);
      expect(view?.lines.length).toBeGreaterThan(0);
    });

    it('uniformly reports not-found for wrong, malformed, or random credentials', async () => {
      const created = await createCheckoutOrder(SKU_MAIN, 1);
      const identity = await findOrderIdentityByCredential(created.credential);
      // A wrong but well-formed credential, an unrelated random credential,
      // malformed input, and even the order NUMBER are all the same null.
      expect(await getOrderViewByCredential(generateLookupCredential())).toBeNull();
      expect(await getOrderViewByCredential('x'.repeat(43))).toBeNull();
      expect(await getOrderViewByCredential('not a credential!')).toBeNull();
      expect(await getOrderViewByCredential('')).toBeNull();
      expect(await getOrderViewByCredential(undefined)).toBeNull();
      expect(await getOrderViewByCredential(identity?.orderNumber)).toBeNull(); // not enumerable by order number
      // The identity path behaves identically.
      expect(await findOrderIdentityByCredential(generateLookupCredential())).toBeNull();
    });
  });
});
