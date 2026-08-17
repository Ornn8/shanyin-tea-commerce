/**
 * Mutation audit trail (ADR-0005).
 *
 * Every commerce mutation records actor (allowlisted admin email), timestamp
 * (DB `createdAt`), entity (type + id), and a JSON before/after summary of
 * the affected product data. Summaries deliberately contain product facts,
 * variant rows, and localized copy ONLY — never secrets (passwords, session
 * tokens, cookies). A test asserts the no-secrets invariant.
 */
import { prisma } from '@/lib/prisma';
import { Prisma } from '@/generated/prisma/client';
import type { ProductForm, CaffeineLevel } from '@/generated/prisma/client';
import type { LocalizedRow } from './preview';

export type AuditAction =
  | 'product.create'
  | 'product.update'
  | 'product.publish'
  | 'product.unpublish'
  | 'variant.inventory';

export interface AuditEntry {
  action: AuditAction;
  entityType: 'product' | 'variant';
  entityId: string;
  actorEmail: string;
  /** `null` for creates (nothing existed before). */
  before: unknown;
  after: unknown;
}

export async function writeAudit(entry: AuditEntry): Promise<void> {
  await prisma.auditLog.create({
    data: {
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      actorEmail: entry.actorEmail,
      before: entry.before === null || entry.before === undefined ? Prisma.DbNull : entry.before,
      after: entry.after === null || entry.after === undefined ? Prisma.DbNull : entry.after,
    },
  });
}

export interface ProductRowForAudit {
  id: string;
  slug: string;
  origin: string;
  form: ProductForm;
  caffeine: CaffeineLevel;
  categoryId: string;
  published: boolean;
  publishedAt: Date | null;
  variants: Array<{
    id: string;
    sku: string;
    name: string;
    priceCents: number;
    inventory: number;
  }>;
  localizations: Array<LocalizedRow & { locale: string }>;
}

/** Compact JSON summary of product data (no secrets by construction). */
export function summarizeProduct(row: ProductRowForAudit): Record<string, unknown> {
  return {
    slug: row.slug,
    origin: row.origin,
    form: row.form,
    caffeine: row.caffeine,
    categoryId: row.categoryId,
    published: row.published,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    variants: row.variants.map((variant) => ({
      sku: variant.sku,
      name: variant.name,
      priceCents: variant.priceCents,
      inventory: variant.inventory,
    })),
    localizations: Object.fromEntries(
      row.localizations.map((loc) => [
        loc.locale,
        {
          name: loc.name,
          description: loc.description,
          tastingNotes: loc.tastingNotes,
          brewingNotes: loc.brewingNotes ?? null,
          seoTitle: loc.seoTitle ?? null,
          seoDescription: loc.seoDescription ?? null,
          mediaAlt: loc.mediaAlt ?? null,
        },
      ]),
    ),
  };
}

export function summarizeVariant(variant: {
  sku: string;
  name: string;
  priceCents: number;
  inventory: number;
}): Record<string, unknown> {
  return {
    sku: variant.sku,
    name: variant.name,
    priceCents: variant.priceCents,
    inventory: variant.inventory,
  };
}
