/**
 * Catalog discovery query integration tests (ADR-0004).
 *
 * These tests create two throwaway products in `beforeAll` and remove them in
 * `afterAll`:
 *
 * - `demo-unavailable` — inventory 0, to prove availability filtering and
 *   "unavailable products" behavior on the shared inventory fact.
 * - `demo-fallback` — deliberately missing its `ja` localization row, to
 *   prove the documented deterministic fallback (requested locale → English →
 *   any row) for search and display.
 *
 * Test files run serially (`fileParallelism: false` in vitest.config.ts)
 * because they share one PostgreSQL database.
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { CATALOG_PAGE_SIZE, queryProducts } from '@/lib/products';

const hasDb = Boolean(process.env.DATABASE_URL);
const describeDb = hasDb ? describe : describe.skip;

const TEMP_SLUGS = ['demo-unavailable', 'demo-fallback'] as const;

describeDb('catalog discovery query (ADR-0004)', () => {
  beforeAll(async () => {
    await prisma.$connect();
    const green = await prisma.category.findUniqueOrThrow({ where: { slug: 'green-tea' } });
    const oolong = await prisma.category.findUniqueOrThrow({ where: { slug: 'oolong-tea' } });

    await prisma.product.create({
      data: {
        slug: 'demo-unavailable',
        origin: 'Demo origin',
        form: 'LOOSE',
        caffeine: 'LOW',
        categoryId: green.id,
        published: true,
        variants: {
          create: [{ sku: 'SHY-DEMO-001', name: 'Standard', priceCents: 50000, inventory: 0 }],
        },
        localizations: {
          create: [
            {
              locale: 'zh-CN',
              name: '演示缺货茶',
              description: '演示条目：用于测试缺货筛选。',
              tastingNotes: '演示笔记。',
            },
            {
              locale: 'en',
              name: 'Demo Unavailable Tea',
              description: 'Demo listing used to prove availability filtering.',
              tastingNotes: 'Demo notes.',
            },
            {
              locale: 'ja',
              name: 'デモ在庫切れ茶',
              description: '在庫フィルターのテスト用デモ商品。',
              tastingNotes: 'デモ備考。',
            },
          ],
        },
      },
    });

    // Deliberately NO ja row: for ja, English becomes the effective copy via
    // the ADR-0003 pick order (locale → English → any).
    await prisma.product.create({
      data: {
        slug: 'demo-fallback',
        origin: 'Demo origin',
        form: 'COMPRESSED',
        caffeine: 'MEDIUM',
        categoryId: oolong.id,
        published: true,
        variants: {
          create: [{ sku: 'SHY-DEMO-002', name: 'Standard', priceCents: 42000, inventory: 5 }],
        },
        localizations: {
          create: [
            {
              locale: 'zh-CN',
              name: '回退演示茶',
              description: '演示条目：用于测试确定性回退内容。',
              tastingNotes: '演示笔记。',
            },
            {
              locale: 'en',
              name: 'Fallback Fern Tea',
              description: 'Demo listing used to prove deterministic fallback matching.',
              tastingNotes: 'Demo notes.',
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

  it('combined filters narrow the shared catalog (family + form + caffeine + price)', async () => {
    const darkLowCompressed = await queryProducts({
      locale: 'en',
      category: 'dark-tea',
      caffeine: 'low',
      form: 'compressed',
    });
    expect(darkLowCompressed.products.map((p) => p.slug).sort()).toEqual(['liubao', 'ripe-puerh']);

    const priceRange = await queryProducts({ locale: 'en', priceMinCents: 70000, priceMaxCents: 90000 });
    expect(priceRange.products.map((p) => p.slug).sort()).toEqual(['liubao', 'tieguanyin']);

    const minOnly = await queryProducts({ locale: 'en', priceMinCents: 100000 });
    expect(minOnly.products.map((p) => p.slug).sort()).toEqual(['dahongpao', 'spring-longjing']);

    // demo-unavailable is LOOSE green tea, so it joins the two seeded greens.
    const greenLoose = await queryProducts({ locale: 'en', category: 'green-tea', form: 'loose' });
    expect(greenLoose.products.map((p) => p.slug).sort()).toEqual([
      'biluochun',
      'demo-unavailable',
      'spring-longjing',
    ]);
  });

  it('availability operates on the shared inventory fact', async () => {
    const inStock = await queryProducts({ locale: 'en', inStock: true });
    expect(inStock.products.some((p) => p.slug === 'demo-unavailable')).toBe(false);
    expect(inStock.products.some((p) => p.slug === 'spring-longjing')).toBe(true);

    const outOfStock = await queryProducts({ locale: 'en', inStock: false });
    expect(outOfStock.products.map((p) => p.slug)).toEqual(['demo-unavailable']);
    expect(outOfStock.total).toBe(1);
  });

  it('search matches the active locale’s copy and falls back deterministically', async () => {
    // ja has no row for demo-fallback → English is the effective copy.
    const jaFallback = await queryProducts({ locale: 'ja', q: 'Fallback' });
    expect(jaFallback.products.some((p) => p.slug === 'demo-fallback')).toBe(true);

    // zh-CN HAS its own row → the English name must NOT match there.
    const zhFallback = await queryProducts({ locale: 'zh-CN', q: 'Fallback' });
    expect(zhFallback.products.some((p) => p.slug === 'demo-fallback')).toBe(false);

    const zhOwn = await queryProducts({ locale: 'zh-CN', q: '回退' });
    expect(zhOwn.products.some((p) => p.slug === 'demo-fallback')).toBe(true);
  });

  it('empty results are deterministic for nonsense or impossible filters', async () => {
    const none = await queryProducts({ locale: 'en', q: 'zzz-no-such-tea' });
    expect(none.total).toBe(0);
    expect(none.products).toEqual([]);
    expect(none.page).toBe(1);
    expect(none.pageCount).toBe(1);

    const impossible = await queryProducts({ locale: 'en', category: 'green-tea', form: 'compressed' });
    expect(impossible.total).toBe(0);

    const absurdPrice = await queryProducts({ locale: 'en', priceMinCents: 99999999 });
    expect(absurdPrice.total).toBe(0);
  });

  it('pagination is stable: page size, clamping, and totals', async () => {
    // green-tea holds 3 products here (2 seeded + demo-unavailable).
    const first = await queryProducts({ locale: 'en', category: 'green-tea', pageSize: 2 });
    expect(first.total).toBe(3);
    expect(first.pageCount).toBe(2);
    expect(first.products).toHaveLength(2);
    expect(first.page).toBe(1);

    const second = await queryProducts({ locale: 'en', category: 'green-tea', pageSize: 2, page: 2 });
    expect(second.products).toHaveLength(1);
    expect(second.page).toBe(2);

    // Out-of-range pages clamp to the last page instead of erroring.
    const far = await queryProducts({ locale: 'en', category: 'green-tea', pageSize: 2, page: 99 });
    expect(far.page).toBe(2);
    expect(far.products).toHaveLength(1);

    // Invalid page values fall back to page 1.
    const zero = await queryProducts({ locale: 'en', category: 'green-tea', pageSize: 2, page: 0 });
    expect(zero.page).toBe(1);

    // Default page size applies when omitted; totals include the fixtures.
    const defaults = await queryProducts({ locale: 'en' });
    expect(defaults.pageSize).toBe(CATALOG_PAGE_SIZE);
    expect(defaults.total).toBe(8);
  });

  it('sorts by price and localized name deterministically', async () => {
    const byPriceAsc = await queryProducts({ locale: 'en', sort: 'price-asc' });
    const cents = byPriceAsc.products.map((p) => p.priceCents);
    expect([...cents].sort((a, b) => a - b)).toEqual(cents);

    const byPriceDesc = await queryProducts({ locale: 'en', sort: 'price-desc' });
    const centsDesc = byPriceDesc.products.map((p) => p.priceCents);
    expect([...centsDesc].sort((a, b) => b - a)).toEqual(centsDesc);

    const byName = await queryProducts({ locale: 'zh-CN', sort: 'name-asc' });
    const names = byName.products.map((p) => p.name);
    expect([...names].sort((a, b) => a.localeCompare(b, 'zh-CN'))).toEqual(names);
  });
});
