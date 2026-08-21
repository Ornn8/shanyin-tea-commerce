/**
 * Direct-database fixtures for the checkout e2e spec (Issue #6).
 *
 * Purchasing through the real UI creates real Order rows (a demo storefront,
 * so a successful purchase is a persistent record — exactly as in production
 * intent). The helper seeds one deterministic published product and, in
 * teardown, deletes every order created by the e2e (identified by the fake
 * `@example.test` shopper email) plus the fixture itself; the fake email also
 * guarantees no real personal data ever reaches the database or artifacts.
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

/** Fake-but-stable shopper identity shared by every checkout journey. */
export const CHECKOUT_SLUG = 'e2e-checkout-primary';
export const CHECKOUT_SKU = 'E2E-CHK-001';
export const CHECKOUT_EMAIL = 'e2e-shopper@example.test';

export async function cleanupCheckoutE2e(): Promise<void> {
  const prisma = db();
  // Every e2e order uses the fake email; delete them (cascades to lines/events).
  await prisma.order.deleteMany({ where: { email: CHECKOUT_EMAIL } });
  const fixture = await prisma.product.findUnique({
    where: { slug: CHECKOUT_SLUG },
    select: { id: true },
  });
  if (fixture) {
    await prisma.auditLog.deleteMany({ where: { entityId: fixture.id } });
    await prisma.product.deleteMany({ where: { id: fixture.id } });
  }
}

export async function seedCheckoutE2e(): Promise<void> {
  const prisma = db();
  await cleanupCheckoutE2e();
  const oolong = await prisma.category.findUniqueOrThrow({ where: { slug: 'oolong-tea' } });
  await prisma.product.create({
    data: {
      slug: CHECKOUT_SLUG,
      origin: 'Demo e2e origin',
      form: 'LOOSE',
      caffeine: 'MEDIUM',
      categoryId: oolong.id,
      published: true,
      publishedAt: new Date(),
      variants: {
        create: [{ sku: CHECKOUT_SKU, name: '100g', priceCents: 15000, inventory: 10, position: 0 }],
      },
      localizations: {
        create: [
          {
            locale: 'zh-CN',
            name: '结算演示茶',
            description: '演示条目：结算端到端测试。',
            tastingNotes: '演示笔记。',
            brewingNotes: '演示冲泡建议。',
          },
          {
            locale: 'en',
            name: 'Checkout Demo Tea',
            description: 'Demo listing used to prove the checkout journey.',
            tastingNotes: 'Demo notes.',
            brewingNotes: 'Demo brewing note.',
          },
          {
            locale: 'ja',
            name: 'チェックアウトデモ茶',
            description: '購入手続きの一連の流れを検証するデモ商品。',
            tastingNotes: 'デモ備考。',
            brewingNotes: 'デモの淹れ方の目安。',
          },
        ],
      },
    },
  });
}

export async function checkoutInventory(): Promise<number> {
  const variant = await db().productVariant.findUnique({
    where: { sku: CHECKOUT_SKU },
    select: { inventory: true },
  });
  return variant?.inventory ?? -1;
}

export async function disconnectCheckoutE2e(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = null;
  }
}
