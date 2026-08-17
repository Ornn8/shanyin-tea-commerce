/**
 * Product detail page data integration tests (Issue #4, ADR-0006).
 *
 * Fixtures (all removed in afterAll):
 *
 * - `demo-detail-multi` — three variants: in-stock primary, low-stock,
 *   out-of-stock; brewing notes stored only in English so the zh-CN/ja pages
 *   render the advertised English fallback (never a blank).
 * - `demo-detail-unpublished` — same category as the multi-variant fixture but
 *   unpublished; recommendations must never expose it and cart lines must
 *   drop its SKU.
 * - `demo-detail-unavailable` — primary variant with inventory 0, so the
 *   default-selected purchase state is unavailable.
 *
 * Test files run serially (`fileParallelism: false`) and share one database.
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import {
  getCartLines,
  getProductDetail,
  getRelatedProducts,
} from '@/lib/products';

const hasDb = Boolean(process.env.DATABASE_URL);
const describeDb = hasDb ? describe : describe.skip;

const TEMP_SLUGS = ['demo-detail-multi', 'demo-detail-unpublished', 'demo-detail-unavailable'] as const;

describeDb('product detail (ADR-0006)', () => {
  beforeAll(async () => {
    await prisma.$connect();
    const oolong = await prisma.category.findUniqueOrThrow({ where: { slug: 'oolong-tea' } });
    const dark = await prisma.category.findUniqueOrThrow({ where: { slug: 'dark-tea' } });

    await prisma.product.create({
      data: {
        slug: 'demo-detail-multi',
        origin: 'Demo origin',
        form: 'LOOSE',
        caffeine: 'MEDIUM',
        categoryId: oolong.id,
        published: true,
        variants: {
          create: [
            { sku: 'SHY-DET-001', name: '100g', priceCents: 15000, inventory: 10 },
            { sku: 'SHY-DET-002', name: '50g', priceCents: 7500, inventory: 3 },
            { sku: 'SHY-DET-003', name: '250g', priceCents: 30000, inventory: 0 },
          ],
        },
        localizations: {
          create: [
            {
              locale: 'zh-CN',
              name: '多规格演示茶',
              description: '演示条目。',
              tastingNotes: '演示笔记。',
              // Deliberately empty: the storefront renders the English fallback.
              brewingNotes: '',
            },
            {
              locale: 'en',
              name: 'Multi-Variant Demo Tea',
              description: 'Demo listing used to prove variant selection.',
              tastingNotes: 'Demo notes.',
              brewingNotes: 'English brewing guidance used as the fallback for other locales.',
            },
            {
              locale: 'ja',
              name: '多規格デモ茶',
              description: 'デモ商品。',
              tastingNotes: 'デモ備考。',
              // Deliberately empty: the storefront renders the English fallback.
              brewingNotes: '',
            },
          ],
        },
      },
    });

    await prisma.product.create({
      data: {
        slug: 'demo-detail-unpublished',
        origin: 'Demo origin',
        form: 'COMPRESSED',
        caffeine: 'LOW',
        categoryId: oolong.id,
        published: false,
        variants: { create: [{ sku: 'SHY-DET-004', name: '100g', priceCents: 12000, inventory: 5 }] },
        localizations: {
          create: [
            {
              locale: 'en',
              name: 'Unpublished Demo Tea',
              description: 'Must never surface in recommendations or cart lines.',
              tastingNotes: 'Demo notes.',
            },
          ],
        },
      },
    });

    await prisma.product.create({
      data: {
        slug: 'demo-detail-unavailable',
        origin: 'Demo origin',
        form: 'COMPRESSED',
        caffeine: 'LOW',
        categoryId: dark.id,
        published: true,
        variants: {
          create: [
            { sku: 'SHY-DET-005', name: '200g', priceCents: 20000, inventory: 0 },
            { sku: 'SHY-DET-006', name: '100g', priceCents: 10000, inventory: 5 },
          ],
        },
        localizations: {
          create: [
            {
              locale: 'en',
              name: 'Unavailable Default Demo Tea',
              description: 'Default variant is out of stock.',
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

  it('returns every variant in first-created order with language-neutral facts', async () => {
    const detail = await getProductDetail('demo-detail-multi', 'en');
    expect(detail).not.toBeNull();
    expect(detail!.variants.map((v) => v.sku)).toEqual([
      'SHY-DET-001',
      'SHY-DET-002',
      'SHY-DET-003',
    ]);
    expect(detail!.variants.map((v) => v.priceCents)).toEqual([15000, 7500, 30000]);
    expect(detail!.variants.map((v) => v.inventory)).toEqual([10, 3, 0]);
    expect(detail!.variants.every((v) => v.name)).toBe(true);
  });

  it('keeps a stable language-neutral product identity across locales', async () => {
    const zh = await getProductDetail('demo-detail-multi', 'zh-CN');
    const ja = await getProductDetail('demo-detail-multi', 'ja');
    const en = await getProductDetail('demo-detail-multi', 'en');
    expect(zh!.id).toBe(ja!.id);
    expect(zh!.id).toBe(en!.id);
    expect(zh!.slug).toBe('demo-detail-multi');
    expect(zh!.sku).toBe('SHY-DET-001');
  });

  it('applies the English fallback to brewing guidance (never a blank)', async () => {
    const fallback = 'English brewing guidance used as the fallback for other locales.';
    // zh-CN stores an empty brewing note → English fallback.
    const zh = await getProductDetail('demo-detail-multi', 'zh-CN');
    expect(zh!.brewingNotes).toBe(fallback);
    // ja stores an empty brewing note → English fallback.
    const ja = await getProductDetail('demo-detail-multi', 'ja');
    expect(ja!.brewingNotes).toBe(fallback);
    // English renders its own copy.
    const en = await getProductDetail('demo-detail-multi', 'en');
    expect(en!.brewingNotes).toBe(fallback);

    // mediaAlt is unset everywhere → null (the UI falls back to the localized
    // message key); seo fields unset → null.
    expect(zh!.mediaAlt).toBeNull();
    expect(zh!.seoTitle).toBeNull();
    expect(zh!.seoDescription).toBeNull();
  });

  it('never returns unpublished products or unknown slugs', async () => {
    expect(await getProductDetail('demo-detail-unpublished', 'en')).toBeNull();
    expect(await getProductDetail('no-such-slug', 'en')).toBeNull();
  });

  it('reports an unavailable default variant with an in-stock alternative', async () => {
    const detail = await getProductDetail('demo-detail-unavailable', 'en');
    expect(detail).not.toBeNull();
    expect(detail!.variants[0].inventory).toBe(0);
    expect(detail!.variants[1].inventory).toBe(5);
  });

  it('recommendations exclude the current product, unpublished products, and duplicates', async () => {
    const related = await getRelatedProducts({
      slug: 'demo-detail-multi',
      locale: 'en',
      limit: 3,
    });
    const slugs = related.map((p) => p.slug);
    expect(slugs).not.toContain('demo-detail-multi');
    expect(slugs).not.toContain('demo-detail-unpublished');
    expect(new Set(slugs).size).toBe(slugs.length); // one record per product
    // Same category (seeded oolongs) ranks first, deterministically.
    expect(slugs[0]).toBe('tieguanyin');
    expect(slugs[1]).toBe('dahongpao');
    expect(slugs).toHaveLength(3);
    // Limit of 1 honors the cap.
    const one = await getRelatedProducts({ slug: 'demo-detail-multi', locale: 'en', limit: 1 });
    expect(one).toHaveLength(1);
  });

  it('cart lines resolve the exact variant added (SKU, price, unit)', async () => {
    const lines = await getCartLines(
      ['SHY-DET-001', 'SHY-DET-002', 'SHY-DET-003', 'SHY-DET-004', 'SHY-NOPE'],
      'en',
    );
    expect(lines.map((line) => line.variant.sku)).toEqual(['SHY-DET-001', 'SHY-DET-002', 'SHY-DET-003']);
    expect(lines.map((line) => line.variant.priceCents)).toEqual([15000, 7500, 30000]);
    expect(lines.map((line) => line.variant.name)).toEqual(['100g', '50g', '250g']);
    // Order follows the cookie; unknown SKUs and unpublished products are dropped.
    const reversed = await getCartLines(['SHY-DET-003', 'SHY-DET-001'], 'en');
    expect(reversed.map((line) => line.variant.sku)).toEqual(['SHY-DET-003', 'SHY-DET-001']);
    // Facts are language-neutral: prices identical across locales, copy differs.
    const zhLines = await getCartLines(['SHY-DET-001'], 'zh-CN');
    expect(zhLines[0].variant.priceCents).toBe(15000);
    expect(zhLines[0].product.name).toBe('多规格演示茶');
  });
});