/**
 * Cart service + revalidation integration tests (Issue #5, ADR-0007).
 *
 * Fixtures (all removed in afterAll):
 *
 * - `demo-cart-live` — published product with three variants:
 *   SHY-CART-001 (inventory 10, ¥150.00), SHY-CART-002 (inventory 3, ¥75.00),
 *   SHY-CART-003 (inventory 0, ¥300.00) — for in-stock, low-capped, and
 *   out-of-stock revalidation.
 * - `demo-cart-unpublished` — unpublished product whose SKU must never resolve
 *   to a cart line and must be pruned.
 *
 * Test files run serially (`fileParallelism: false`) and share one database.
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import type { CartItem } from '@/lib/cart';
import { EMPTY_CART, CART_MAX_QTY } from '@/lib/cart';
import { resolveCartItems } from '@/lib/products';
import {
  addToCartService,
  pruneStaleState,
  reconcileCartState,
  removeCartItemService,
  setCartItemQuantityService,
} from '@/lib/cart-service';

const hasDb = Boolean(process.env.DATABASE_URL);
const describeDb = hasDb ? describe : describe.skip;

const TEMP_SLUGS = ['demo-cart-live', 'demo-cart-unpublished'] as const;

const SKU_IN_STOCK = 'SHY-CART-001';
const SKU_LOW = 'SHY-CART-002';
const SKU_OUT = 'SHY-CART-003';
const SKU_UNPUBLISHED = 'SHY-CART-UNP';

function item(sku: string, qty: number, priceCents: number, addedAt = 1): CartItem {
  return { sku, qty, priceCents, addedAt };
}

describeDb('cart (ADR-0007)', () => {
  beforeAll(async () => {
    await prisma.$connect();
    const oolong = await prisma.category.findUniqueOrThrow({ where: { slug: 'oolong-tea' } });

    await prisma.product.create({
      data: {
        slug: 'demo-cart-live',
        origin: 'Demo origin',
        form: 'LOOSE',
        caffeine: 'MEDIUM',
        categoryId: oolong.id,
        published: true,
        variants: {
          create: [
            { sku: SKU_IN_STOCK, name: '100g', priceCents: 15000, inventory: 10, position: 0 },
            { sku: SKU_LOW, name: '50g', priceCents: 7500, inventory: 3, position: 1 },
            { sku: SKU_OUT, name: '200g', priceCents: 30000, inventory: 0, position: 2 },
          ],
        },
        localizations: {
          create: [
            {
              locale: 'zh-CN',
              name: '购物袋演示茶',
              description: '演示条目。',
              tastingNotes: '演示笔记。',
              brewingNotes: '演示冲泡建议。',
            },
            {
              locale: 'en',
              name: 'Cart Demo Tea',
              description: 'Demo cart revalidation fixture.',
              tastingNotes: 'Demo notes.',
              brewingNotes: 'Demo brewing note.',
            },
            {
              locale: 'ja',
              name: 'カートデモ茶',
              description: 'カート再検証用のデモ商品。',
              tastingNotes: 'デモ備考。',
              brewingNotes: 'デモの淹れ方の目安。',
            },
          ],
        },
      },
    });

    await prisma.product.create({
      data: {
        slug: 'demo-cart-unpublished',
        origin: 'Demo origin',
        form: 'COMPRESSED',
        caffeine: 'LOW',
        categoryId: oolong.id,
        published: false,
        variants: { create: [{ sku: SKU_UNPUBLISHED, name: '100g', priceCents: 9000, inventory: 5, position: 0 }] },
        localizations: {
          create: [
            {
              locale: 'zh-CN',
              name: '未发布购物袋演示茶',
              description: '演示条目。',
              tastingNotes: '演示笔记。',
            },
            {
              locale: 'en',
              name: 'Unpublished Cart Demo Tea',
              description: 'Must never appear in cart lines.',
              tastingNotes: 'Demo notes.',
            },
            {
              locale: 'ja',
              name: '未公開カートデモ茶',
              description: 'カート行に表示してはならない。',
              tastingNotes: 'デモ備考。',
            },
          ],
        },
      },
    });
  });

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { slug: { in: [...TEMP_SLUGS] } } });
    await prisma.$disconnect();
  });

  describe('resolveCartItems (server-side revalidation per render)', () => {
    it('resolves quantity-aware lines in cart order with live facts', async () => {
      const items = [item(SKU_IN_STOCK, 2, 15000), item(SKU_LOW, 1, 7500)];
      const res = await resolveCartItems(items, 'en');
      expect(res.removedSkus).toEqual([]);
      expect(res.lines.map((line) => line.sku)).toEqual([SKU_IN_STOCK, SKU_LOW]);
      expect(res.lines[0].qty).toBe(2);
      expect(res.lines[0].effectiveQty).toBe(2);
      expect(res.lines[0].priceCents).toBe(15000);
      expect(res.lines[0].issues).toEqual([]);
      expect(res.lines[1].variant.name).toBe('50g');
    });

    it('flags a price change against the stored snapshot', async () => {
      const items = [item(SKU_IN_STOCK, 1, 12000)]; // snapshot differs from live 15000
      const res = await resolveCartItems(items, 'en');
      expect(res.lines[0].issues).toContain('price-changed');
      expect(res.lines[0].snapshotPriceCents).toBe(12000);
      expect(res.lines[0].priceCents).toBe(15000);
    });

    it('clamps quantities to current inventory and flags the shortage', async () => {
      const within = await resolveCartItems([item(SKU_IN_STOCK, 10, 15000)], 'en');
      expect(within.lines[0].effectiveQty).toBe(10);
      expect(within.lines[0].issues).toEqual([]);

      const over = await resolveCartItems([item(SKU_IN_STOCK, 12, 15000)], 'en');
      expect(over.lines[0].effectiveQty).toBe(10);
      expect(over.lines[0].issues).toContain('insufficient-stock');

      const low = await resolveCartItems([item(SKU_LOW, 5, 7500)], 'en');
      expect(low.lines[0].effectiveQty).toBe(3);
      expect(low.lines[0].issues).toContain('insufficient-stock');
    });

    it('yields an effective quantity of zero for an out-of-stock line', async () => {
      const res = await resolveCartItems([item(SKU_OUT, 1, 30000)], 'en');
      expect(res.lines[0].effectiveQty).toBe(0);
      expect(res.lines[0].issues).toContain('insufficient-stock');
    });

    it('drops unpublished and unknown SKUs and reports them', async () => {
      const res = await resolveCartItems(
        [item(SKU_IN_STOCK, 1, 15000), item(SKU_UNPUBLISHED, 1, 9000)],
        'en',
      );
      expect(res.lines.map((line) => line.sku)).toEqual([SKU_IN_STOCK]);
      expect(res.removedSkus).toEqual([SKU_UNPUBLISHED]);
    });

    it('is locale-independent for the line set and totals inputs', async () => {
      const items = [item(SKU_IN_STOCK, 2, 15000), item(SKU_LOW, 3, 7500)];
      // Same SKUs, quantities, and live prices in every locale.
      const en = await resolveCartItems(items, 'en');
      const zh = await resolveCartItems(items, 'zh-CN');
      const ja = await resolveCartItems(items, 'ja');
      const facts = (res: Awaited<ReturnType<typeof resolveCartItems>>) =>
        res.lines.map((line) => [line.sku, line.qty, line.effectiveQty, line.priceCents]);
      expect(facts(zh)).toEqual(facts(en));
      expect(facts(ja)).toEqual(facts(en));
      // Only the localized product copy differs.
      expect(en.lines[0].product.name).toBe('Cart Demo Tea');
      expect(zh.lines[0].product.name).toBe('购物袋演示茶');
      expect(ja.lines[0].product.name).toBe('カートデモ茶');
      // No duplicate lines ever appear (cookie order preserved).
      expect(new Set(zh.lines.map((line) => line.sku)).size).toBe(zh.lines.length);
    });
  });

  describe('cart service mutations (server-validated, atomic, bounded)', () => {
    it('rejects invalid input', async () => {
      for (const [rawSku, rawQty] of [
        [undefined, 1],
        ['', 1],
        [SKU_IN_STOCK, 0],
        [SKU_IN_STOCK, -1],
        [SKU_IN_STOCK, 2.5],
        [SKU_IN_STOCK, CART_MAX_QTY + 1],
        [42, 1],
      ] as Array<[unknown, unknown]>) {
        const result = await addToCartService(EMPTY_CART, rawSku, rawQty);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.code).toBe('invalid-input');
      }
    });

    it('rejects unknown and unpublished SKUs and out-of-stock variants', async () => {
      expect((await addToCartService(EMPTY_CART, 'SHY-NOPE', 1)).ok).toBe(false);
      expect((await addToCartService(EMPTY_CART, SKU_UNPUBLISHED, 1)).ok).toBe(false);
      const out = await addToCartService(EMPTY_CART, SKU_OUT, 1);
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.code).toBe('insufficient-stock');
    });

    it('adds new lines with a server-captured price snapshot', async () => {
      const result = await addToCartService(EMPTY_CART, SKU_IN_STOCK, 2);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.state.items).toHaveLength(1);
      expect(result.state.items[0]).toMatchObject({ sku: SKU_IN_STOCK, qty: 2, priceCents: 15000 });
    });

    it('merges additively but never exceeds the current inventory', async () => {
      const created = await addToCartService(EMPTY_CART, SKU_IN_STOCK, 8);
      if (!created.ok) throw new Error('add failed');
      const merged = await addToCartService(created.state, SKU_IN_STOCK, 6);
      if (!merged.ok) throw new Error('add failed');
      // 8 + 6 = 14 requested, capped at the live inventory of 10.
      expect(merged.state.items[0].qty).toBe(10);
      // The original snapshot is preserved across merges.
      expect(merged.state.items[0].priceCents).toBe(15000);
    });

    it('sets and clamps quantities; zero removes; stale lines are dropped', async () => {
      const created = await addToCartService(EMPTY_CART, SKU_LOW, 1);
      if (!created.ok) throw new Error('add failed');
      // Asking for more than the 3-unit stock clamps to 3.
      const clamped = await setCartItemQuantityService(created.state, SKU_LOW, 5);
      if (!clamped.ok) throw new Error('set failed');
      expect(clamped.state.items[0].qty).toBe(3);
      // Zero removes the line.
      const removedQty = await setCartItemQuantityService(clamped.state, SKU_LOW, 0);
      if (!removedQty.ok) throw new Error('set failed');
      expect(removedQty.state).toEqual(EMPTY_CART);
      // A quantity above the hard bound is rejected.
      const tooHigh = await setCartItemQuantityService(created.state, SKU_LOW, CART_MAX_QTY + 1);
      expect(tooHigh.ok).toBe(false);
    });

    it('removes a line by SKU', async () => {
      const created = await addToCartService(EMPTY_CART, SKU_IN_STOCK, 1);
      if (!created.ok) throw new Error('add failed');
      const removed = await removeCartItemService(created.state, SKU_IN_STOCK);
      expect(removed.ok).toBe(true);
      if (removed.ok) expect(removed.state).toEqual(EMPTY_CART);
      expect((await removeCartItemService(EMPTY_CART, 42)).ok).toBe(false);
    });

    it('prunes stale (unpublished/unknown) lines before writes', async () => {
      const created = await addToCartService(EMPTY_CART, SKU_IN_STOCK, 1);
      if (!created.ok) throw new Error('add failed');
      const mixed = {
        status: 'ok' as const,
        items: [
          ...created.state.items,
          item(SKU_UNPUBLISHED, 1, 9000),
          item('SHY-VANISHED', 1, 1000),
        ],
      };
      const pruned = await pruneStaleState(mixed);
      expect(pruned.status).toBe('ok');
      expect(pruned.items.map((entry) => entry.sku)).toEqual([SKU_IN_STOCK]);

      const allStale = await pruneStaleState({
        status: 'ok',
        items: [item(SKU_UNPUBLISHED, 1, 9000), item('SHY-VANISHED', 1, 1000)],
      });
      expect(allStale).toEqual(EMPTY_CART);
    });
  });

  describe('reconcileCartState (persist cleared + revalidated state)', () => {
    it('clears an expired, void, or empty cart', async () => {
      expect(await reconcileCartState({ status: 'expired', items: [] })).toEqual(EMPTY_CART);
      expect(await reconcileCartState(EMPTY_CART)).toEqual(EMPTY_CART);
    });

    it('prunes unpublished/unknown lines and clamps over-stock quantities', async () => {
      const reconciled = await reconcileCartState({
        status: 'ok',
        items: [
          item(SKU_IN_STOCK, 12, 15000), // clamped to live inventory 10
          item(SKU_LOW, 5, 7500), // clamped to live inventory 3
          item(SKU_UNPUBLISHED, 1, 9000), // unpublished → dropped
          item('SHY-VANISHED', 1, 1000), // unknown → dropped
        ],
      });
      expect(reconciled.status).toBe('ok');
      expect(reconciled.items.map((entry) => [entry.sku, entry.qty])).toEqual([
        [SKU_IN_STOCK, 10],
        [SKU_LOW, 3],
      ]);
      // Identity (snapshot price, add time) is preserved through clamping.
      expect(reconciled.items[0].priceCents).toBe(15000);
      expect(reconciled.items[1].priceCents).toBe(7500);
    });

    it('drops an out-of-stock line (it cannot honestly hold a quantity)', async () => {
      const reconciled = await reconcileCartState({
        status: 'ok',
        items: [item(SKU_OUT, 1, 30000)],
      });
      expect(reconciled).toEqual(EMPTY_CART);
    });

    it('leaves a fully valid cart unchanged', async () => {
      const source = {
        status: 'ok' as const,
        items: [item(SKU_IN_STOCK, 2, 15000), item(SKU_LOW, 1, 7500)],
      };
      const reconciled = await reconcileCartState(source);
      expect(reconciled).toEqual(source);
    });

    it('returns the empty cart when every line is stale', async () => {
      expect(
        await reconcileCartState({
          status: 'ok',
          items: [item(SKU_UNPUBLISHED, 1, 9000), item(SKU_OUT, 1, 30000)],
        }),
      ).toEqual(EMPTY_CART);
    });
  });
});