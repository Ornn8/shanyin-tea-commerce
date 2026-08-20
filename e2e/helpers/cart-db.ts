/**
 * Direct-database fixtures for the cart e2e spec (Issue #5).
 *
 * Specs need deterministic published products with controlled inventory and
 * price so quantities, the shipping-estimate threshold, long localized names,
 * concurrent stock changes, price changes, and the unpublish-removal path can
 * be exercised through the real storefront UI. The helper loads `.env`
 * locally; in CI the workflow exports DATABASE_URL directly.
 */
import 'dotenv/config';
import { PrismaClient } from '../../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;
let client: PrismaClient | null = null;

function db(): PrismaClient {
  if (!connectionString) throw new Error('DATABASE_URL is not set (see SETUP.md)');
  if (!client) client = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  return client;
}

export const CART_SLUGS = ['e2e-cart-primary', 'e2e-cart-longname', 'e2e-cart-revalidate'] as const;
export const CART_SKU_MAIN = 'E2E-CART-001';
export const CART_SKU_MAIN_2 = 'E2E-CART-002';
export const CART_SKU_REVALIDATE = 'E2E-CART-RV';
export const CART_SKU_LONGNAME = 'E2E-CART-LONG';

export async function cleanupCartE2e(): Promise<void> {
  const prisma = db();
  const rows = await prisma.product.findMany({
    where: { slug: { in: [...CART_SLUGS] } },
    select: { id: true },
  });
  const ids = rows.map((row) => row.id);
  if (ids.length > 0) {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: ids } } });
    await prisma.product.deleteMany({ where: { id: { in: ids } } });
  }
}

export async function seedCartE2e(): Promise<void> {
  const prisma = db();
  await cleanupCartE2e();
  const oolong = await prisma.category.findUniqueOrThrow({ where: { slug: 'oolong-tea' } });

  // Primary fixture: default variant ¥150.00 / 10 units (below the ¥200 free-
  // shipping threshold at qty 1, free at qty 2), plus a lower-inventory
  // secondary variant.
  await prisma.product.create({
    data: {
      slug: 'e2e-cart-primary',
      origin: 'Demo e2e origin',
      form: 'LOOSE',
      caffeine: 'MEDIUM',
      categoryId: oolong.id,
      published: true,
      publishedAt: new Date(),
      variants: {
        create: [
          { sku: CART_SKU_MAIN, name: '100g', priceCents: 15000, inventory: 10, position: 0 },
          { sku: CART_SKU_MAIN_2, name: '200g', priceCents: 28000, inventory: 3, position: 1 },
        ],
      },
      localizations: {
        create: [
          {
            locale: 'zh-CN',
            name: '购物袋演示茶',
            description: '演示条目：购物袋端到端测试。',
            tastingNotes: '演示笔记。',
            brewingNotes: '演示冲泡建议。',
          },
          {
            locale: 'en',
            name: 'Cart Demo Tea',
            description: 'Demo listing used to prove the cart journey.',
            tastingNotes: 'Demo notes.',
            brewingNotes: 'Demo brewing note.',
          },
          {
            locale: 'ja',
            name: 'カートデモ茶',
            description: 'カートの一連の流れを検証するデモ商品。',
            tastingNotes: 'デモ備考。',
            brewingNotes: 'デモの淹れ方の目安。',
          },
        ],
      },
    },
  });

  // Long-name fixture: the cart line must wrap instead of overflowing, with
  // CJK (esp. Japanese) text keeping native line breaking.
  await prisma.product.create({
    data: {
      slug: 'e2e-cart-longname',
      origin: 'Demo e2e origin',
      form: 'COMPRESSED',
      caffeine: 'LOW',
      categoryId: oolong.id,
      published: true,
      publishedAt: new Date(),
      variants: {
        create: [{ sku: CART_SKU_LONGNAME, name: '限定特大装', priceCents: 99900, inventory: 5, position: 0 }],
      },
      localizations: {
        create: [
          {
            locale: 'zh-CN',
            name: '购物袋端到端测试示例茶叶——这是特意加长的商品名称，用于验证在窄屏幕上能够自动换行而不是溢出',
            description: '演示条目。',
            tastingNotes: '演示笔记。',
            brewingNotes: '演示冲泡建议。',
          },
          {
            locale: 'en',
            name: 'E2E Cart Tea with an Exceptionally Long English Product Title That Must Wrap Gracefully Instead of Overflowing on Narrow Screens',
            description: 'Demo listing with a deliberately long product name.',
            tastingNotes: 'Demo notes.',
            brewingNotes: 'Demo brewing note.',
          },
          {
            locale: 'ja',
            name: 'カートE2Eテスト用の非常に長い日本語の茶葉名で、画面の幅が狭くても折り返して表示されることを確認するためのものです',
            description: '長い商品名を持つデモ商品。',
            tastingNotes: 'デモ備考。',
            brewingNotes: 'デモの淹れ方の目安。',
          },
        ],
      },
    },
  });

  // Revalidation fixture: used by the concurrent stock / price / unpublish
  // tests, which mutate it in place and restore it in their teardown.
  await prisma.product.create({
    data: {
      slug: 'e2e-cart-revalidate',
      origin: 'Demo e2e origin',
      form: 'LOOSE',
      caffeine: 'MEDIUM',
      categoryId: oolong.id,
      published: true,
      publishedAt: new Date(),
      variants: {
        create: [{ sku: CART_SKU_REVALIDATE, name: '100g', priceCents: 15000, inventory: 10, position: 0 }],
      },
      localizations: {
        create: [
          {
            locale: 'zh-CN',
            name: '再校验演示茶',
            description: '演示条目。',
            tastingNotes: '演示笔记。',
            brewingNotes: '演示冲泡建议。',
          },
          {
            locale: 'en',
            name: 'Revalidate Demo Tea',
            description: 'Demo listing whose stock/price are mutated mid-test.',
            tastingNotes: 'Demo notes.',
            brewingNotes: 'Demo brewing note.',
          },
          {
            locale: 'ja',
            name: '再検証デモ茶',
            description: '在庫・価格をテスト中に変更するデモ商品。',
            tastingNotes: 'デモ備考。',
            brewingNotes: 'デモの淹れ方の目安。',
          },
        ],
      },
    },
  });
}

export async function setVariantInventory(sku: string, inventory: number): Promise<void> {
  await db().productVariant.update({ where: { sku }, data: { inventory } });
}

export async function setVariantPrice(sku: string, priceCents: number): Promise<void> {
  await db().productVariant.update({ where: { sku }, data: { priceCents } });
}

export async function setProductPublished(slug: string, published: boolean): Promise<void> {
  await db().product.update({ where: { slug }, data: { published } });
}

export async function disconnectCartE2e(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = null;
  }
}