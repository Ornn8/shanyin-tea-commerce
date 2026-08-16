import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getProductBySlug, getProductsBySkus, listCategories, listProducts, searchProducts } from '@/lib/products';
import { LOCALE_IDS } from '@/i18n/registry';

const hasDb = Boolean(process.env.DATABASE_URL);
const describeDb = hasDb ? describe : describe.skip;

describeDb('PostgreSQL + Prisma integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('seeded catalog: 3 categories, 6 products, every product localized in all locales', async () => {
    const [categories, products] = await Promise.all([prisma.category.count(), prisma.product.count()]);
    expect(categories).toBe(3);
    expect(products).toBe(6);
    const rows = await prisma.product.findMany({ include: { localizations: true } });
    for (const row of rows) {
      expect(new Set(row.localizations.map((loc) => loc.locale))).toEqual(new Set(LOCALE_IDS));
    }
  });

  it('commerce facts are language-neutral and shared', async () => {
    const rows = await prisma.product.findMany();
    expect(new Set(rows.map((row) => row.slug)).size).toBe(rows.length);
    expect(new Set(rows.map((row) => row.sku)).size).toBe(rows.length);
    for (const row of rows) {
      expect(row.priceCents).toBeGreaterThan(0);
      expect(row.currency).toBe('CNY');
      expect(row.inventory).toBeGreaterThanOrEqual(0);
      expect(row.origin.length).toBeGreaterThan(0);
    }
  });

  it('localized views render the same catalog facts across locales', async () => {
    const zh = await listProducts('zh-CN');
    const en = await listProducts('en');
    const ja = await listProducts('ja');
    expect(zh).toHaveLength(6);
    expect(en).toHaveLength(6);
    expect(ja).toHaveLength(6);
    for (let i = 0; i < zh.length; i++) {
      expect(zh[i].priceCents).toBe(en[i].priceCents);
      expect(zh[i].priceCents).toBe(ja[i].priceCents);
      expect(zh[i].sku).toBe(en[i].sku);
      expect(zh[i].origin).toBe(ja[i].origin);
      expect(zh[i].inventory).toBe(en[i].inventory);
      // Localized copy may vary…
      expect(zh[i].name).not.toBe(en[i].name);
      expect(zh[i].description.length).toBeGreaterThan(0);
    }
  });

  it('category listing is localized with shared counts', async () => {
    const zh = await listCategories('zh-CN');
    const en = await listCategories('en');
    expect(zh).toHaveLength(3);
    expect(en).toHaveLength(3);
    expect(zh[0].name).toBe('绿茶');
    expect(en[0].name).toBe('Green tea');
    expect(zh[0].productCount).toBe(en[0].productCount);
  });

  it('search matches localized names in the locale of the query', async () => {
    const enResults = await searchProducts('Longjing', 'en');
    expect(enResults.some((p) => p.slug === 'spring-longjing')).toBe(true);
    const zhResults = await searchProducts('龙井', 'zh-CN');
    expect(zhResults.some((p) => p.slug === 'spring-longjing')).toBe(true);
    const jaResults = await searchProducts('龍井', 'ja');
    expect(jaResults.some((p) => p.slug === 'spring-longjing')).toBe(true);
  });

  it('detail lookup returns a localized product or null', async () => {
    const ja = await getProductBySlug('liubao', 'ja');
    expect(ja?.name).toBe('六堡茶');
    expect(await getProductBySlug('does-not-exist', 'en')).toBeNull();
  });

  it('getProductsBySkus preserves cart order and skips unknown skus', async () => {
    const items = await getProductsBySkus(['SHY-G-001', 'NOPE', 'SHY-O-002'], 'ja');
    expect(items.map((item) => item.sku)).toEqual(['SHY-G-001', 'SHY-O-002']);
  });
});
