/**
 * Direct-database fixtures for the product-detail e2e spec (Issue #4).
 *
 * The spec needs deterministic seeded-in-DB products that cannot be created
 * through the storefront UI: an unavailable-default-variant product and an
 * unpublished product (which must never appear in recommendations). This
 * helper creates/cleans `e2e-product-*` fixtures by slug. It loads `.env`
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

export async function cleanupProductDetailE2e(): Promise<void> {
  const prisma = db();
  const rows = await prisma.product.findMany({
    where: { slug: { startsWith: 'e2e-product-' } },
    select: { id: true },
  });
  const ids = rows.map((row) => row.id);
  if (ids.length > 0) {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: ids } } });
    await prisma.product.deleteMany({ where: { id: { in: ids } } });
  }
}

export async function seedProductDetailE2e(): Promise<void> {
  const prisma = db();
  await cleanupProductDetailE2e();

  const green = await prisma.category.findUniqueOrThrow({ where: { slug: 'green-tea' } });

  // Unavailable default variant: the page loads with an out-of-stock
  // selection; the in-stock alternative must restore add-to-cart.
  await prisma.product.create({
    data: {
      slug: 'e2e-product-unavailable',
      origin: 'Demo e2e origin',
      form: 'LOOSE',
      caffeine: 'MEDIUM',
      categoryId: green.id,
      published: true,
      publishedAt: new Date(),
      variants: {
        create: [
          { sku: 'E2E-PRD-001', name: '200g', priceCents: 30000, inventory: 0 },
          { sku: 'E2E-PRD-002', name: '100g', priceCents: 15000, inventory: 6 },
        ],
      },
      localizations: {
        create: [
          {
            locale: 'zh-CN',
            name: '默认无货演示茶',
            description: '演示条目：默认规格缺货。',
            tastingNotes: '演示笔记。',
            brewingNotes: '演示冲泡建议。',
          },
          {
            locale: 'en',
            name: 'Unavailable Default Demo Tea',
            description: 'Demo listing whose default variant is out of stock.',
            tastingNotes: 'Demo notes.',
            brewingNotes: 'Demo brewing note.',
          },
          {
            locale: 'ja',
            name: '在庫なしデフォルトデモ茶',
            description: 'デフォルト規格が在庫切れのデモ商品。',
            tastingNotes: 'デモ備考。',
            brewingNotes: 'デモの淹れ方の目安。',
          },
        ],
      },
    },
  });

  // Unpublished product in the same category as spring-longjing: must never
  // appear in spring-longjing's recommendations or anywhere on the storefront.
  await prisma.product.create({
    data: {
      slug: 'e2e-product-unpublished',
      origin: 'Demo e2e origin',
      form: 'LOOSE',
      caffeine: 'LOW',
      categoryId: green.id,
      published: false,
      variants: { create: [{ sku: 'E2E-PRD-003', name: '100g', priceCents: 9000, inventory: 5 }] },
      localizations: {
        create: [
          {
            locale: 'zh-CN',
            name: '未发布演示茶',
            description: '演示条目：未发布，不应出现在推荐中。',
            tastingNotes: '演示笔记。',
          },
          {
            locale: 'en',
            name: 'Unpublished Demo Tea',
            description: 'Unpublished fixture — must never surface on the storefront.',
            tastingNotes: 'Demo notes.',
          },
          {
            locale: 'ja',
            name: '未公開デモ茶',
            description: '公開前のデモ商品。ストアフロントには表示されません。',
            tastingNotes: 'デモ備考。',
          },
        ],
      },
    },
  });
}

export async function disconnectProductDetailE2e(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = null;
  }
}