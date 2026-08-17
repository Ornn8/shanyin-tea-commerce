/**
 * Direct-database cleanup helper for the admin e2e spec.
 *
 * Playwright tests cannot create/delete products through the admin UI (there
 * is no delete flow), so this helper removes the deterministic `e2e-admin-*`
 * fixtures before and after the run. It loads `.env` locally; in CI the
 * workflow exports DATABASE_URL directly.
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

export async function cleanupAdminE2e(): Promise<void> {
  const prisma = db();
  const rows = await prisma.product.findMany({
    where: { slug: { startsWith: 'e2e-admin-' } },
    select: { id: true },
  });
  const ids = rows.map((row) => row.id);
  if (ids.length > 0) {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: ids } } });
    await prisma.product.deleteMany({ where: { id: { in: ids } } });
  }
}

export async function disconnectAdminE2e(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = null;
  }
}