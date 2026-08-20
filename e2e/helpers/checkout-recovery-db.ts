/**
 * Direct-database fixtures for the checkout RECOVERY e2e spec (PR #36 review
 * repair, findings #2/#3).
 *
 * The spec seeds an order in a KNOWN state (PENDING with a stock shortage →
 * terminal failure; PAID with the purchased line still in the cart) holding a
 * KNOWN credential + submission key, then drives the real UI to prove:
 *  - a terminal payment failure RELEASES the submission idempotency key, so the
 *    retry creates a FRESH order instead of replaying the terminal one; and
 *  - re-entering payment on an already-PAID order still clears the purchased
 *    cart lines (the "lost response" recovery path).
 *
 * It uses its OWN fixture product/SKU so it never interferes with the main
 * checkout spec's inventory baseline; every seeded row uses the fake
 * `@example.test` shopper email and is removed in teardown.
 */
import 'dotenv/config';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '../../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { hashLookupCredential } from '../../src/lib/order-credentials';

const connectionString = process.env.DATABASE_URL;
let client: PrismaClient | null = null;

function db(): PrismaClient {
  if (!connectionString) throw new Error('DATABASE_URL is not set (see SETUP.md)');
  if (!client) client = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  return client;
}

export const RECOVERY_SLUG = 'e2e-recovery-primary';
export const RECOVERY_SKU = 'E2E-REC-001';
export const RECOVERY_EMAIL = 'e2e-recovery@example.test';
export const RECOVERY_PRICE_CENTS = 15000;

/** The checkout page computes the submission-key fingerprint as the first 16
 * hex chars of SHA-256 over the decoded cart cookie value
 * (`src/app/[locale]/checkout/page.tsx`). Mirror it exactly so a seeded ref can
 * bind to a real cart cookie. */
export function cartFingerprint(cartCookieValue: string): string {
  return createHash('sha256').update(cartCookieValue).digest('hex').slice(0, 16);
}

export async function cleanupRecoveryE2e(): Promise<void> {
  const prisma = db();
  await prisma.order.deleteMany({ where: { email: RECOVERY_EMAIL } });
  const fixture = await prisma.product.findUnique({
    where: { slug: RECOVERY_SLUG },
    select: { id: true },
  });
  if (fixture) {
    await prisma.auditLog.deleteMany({ where: { entityId: fixture.id } });
    await prisma.product.deleteMany({ where: { id: fixture.id } });
  }
}

export async function seedRecoveryE2e(): Promise<void> {
  const prisma = db();
  await cleanupRecoveryE2e();
  const oolong = await prisma.category.findUniqueOrThrow({ where: { slug: 'oolong-tea' } });
  await prisma.product.create({
    data: {
      slug: RECOVERY_SLUG,
      origin: 'Demo recovery e2e origin',
      form: 'LOOSE',
      caffeine: 'MEDIUM',
      categoryId: oolong.id,
      published: true,
      publishedAt: new Date(),
      variants: {
        create: [{ sku: RECOVERY_SKU, name: '100g', priceCents: RECOVERY_PRICE_CENTS, inventory: 5, position: 0 }],
      },
      localizations: {
        create: [
          { locale: 'zh-CN', name: '恢复演示茶', description: '演示条目：结算恢复流程端到端测试。', tastingNotes: '演示笔记。' },
          { locale: 'en', name: 'Recovery Demo Tea', description: 'Demo listing used to prove checkout recovery journeys.', tastingNotes: 'Demo notes.' },
          { locale: 'ja', name: 'リカバリデモ茶', description: '購入手続きの復旧フローを検証するデモ商品。', tastingNotes: 'デモ備考。' },
        ],
      },
    },
  });
}

export async function recoveryInventory(): Promise<number> {
  const variant = await db().productVariant.findUnique({
    where: { sku: RECOVERY_SKU },
    select: { inventory: true },
  });
  return variant?.inventory ?? -1;
}

export async function setRecoveryInventory(next: number): Promise<void> {
  await db().productVariant.update({ where: { sku: RECOVERY_SKU }, data: { inventory: next } });
}

export interface SeededRecoveryOrder {
  orderId: string;
  orderNumber: string;
  /** Plaintext credential — the test hands it to the browser via sessionStorage
   * (only its SHA-256 is stored, exactly as in production). */
  credential: string;
}

/**
 * Seed an order in a known state with a known credential + submission key.
 * qty binds the order line to the same SKU the browser adds to the cart.
 */
export async function seedRecoveryOrder(input: {
  status: 'PENDING' | 'PAID';
  submissionKey: string;
  qty: number;
}): Promise<SeededRecoveryOrder> {
  const prisma = db();
  const credential = randomBytes(32).toString('base64url');
  const lookupHash = hashLookupCredential(credential);
  const subtotal = RECOVERY_PRICE_CENTS * input.qty;
  const order = await prisma.order.create({
    data: {
      orderNumber: `SHY-RECOVERY-${randomUUID()}`,
      status: input.status,
      currency: 'CNY',
      subtotalCents: subtotal,
      shippingFeeCents: 0,
      totalCents: subtotal,
      email: RECOVERY_EMAIL,
      recipientName: 'Recovery Shopper',
      addressLine1: '1 Recovery Lane',
      city: 'Hangzhou',
      region: 'Zhejiang',
      postalCode: '310000',
      countryCode: 'CN',
      lookupHash,
      submissionKey: input.submissionKey,
      gateway: 'simulated',
      providerIntentId: `sim_${randomUUID()}`,
      paidAt: input.status === 'PAID' ? new Date() : null,
      lines: {
        create: [
          {
            sku: RECOVERY_SKU,
            variantName: '100g',
            nameZhCn: '恢复演示茶',
            nameEn: 'Recovery Demo Tea',
            nameJa: 'リカバリデモ茶',
            unitPriceCents: RECOVERY_PRICE_CENTS,
            quantity: input.qty,
            subtotalCents: subtotal,
            currency: 'CNY',
          },
        ],
      },
    },
    select: { id: true, orderNumber: true },
  });
  return { orderId: order.id, orderNumber: order.orderNumber, credential };
}

export async function disconnectRecoveryE2e(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = null;
  }
}
