/**
 * Admin catalog queries — the full merchant view including unpublished
 * products, all variants, all localizations, and per-locale completeness.
 * The storefront never uses these (it filters `published` in
 * `src/lib/products.ts`).
 */
import { prisma } from '@/lib/prisma';
import { completenessCount, TOTAL_LOCALIZED_FIELDS, type LocalizedRow } from './preview';

export interface AdminVariantView {
  id: string;
  sku: string;
  name: string;
  priceCents: number;
  inventory: number;
}

export interface AdminLocalizationView extends LocalizedRow {
  locale: string;
  completeness: number;
  totalFields: number;
}

export interface AdminProductView {
  id: string;
  slug: string;
  origin: string;
  form: 'LOOSE' | 'COMPRESSED';
  caffeine: 'LOW' | 'MEDIUM' | 'HIGH';
  categoryId: string;
  categorySlug: string;
  published: boolean;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  variants: AdminVariantView[];
  localizations: AdminLocalizationView[];
}

export interface AdminCategoryView {
  id: string;
  slug: string;
  names: Record<string, string>;
}

function toLocalizationView(loc: LocalizedRow & { locale: string }): AdminLocalizationView {
  return { ...loc, completeness: completenessCount(loc), totalFields: TOTAL_LOCALIZED_FIELDS };
}

function toProductView(row: {
  id: string;
  slug: string;
  origin: string;
  form: 'LOOSE' | 'COMPRESSED';
  caffeine: 'LOW' | 'MEDIUM' | 'HIGH';
  categoryId: string;
  published: boolean;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  category: { slug: string };
  variants: AdminVariantView[];
  localizations: Array<LocalizedRow & { locale: string }>;
}): AdminProductView {
  return {
    id: row.id,
    slug: row.slug,
    origin: row.origin,
    form: row.form,
    caffeine: row.caffeine,
    categoryId: row.categoryId,
    categorySlug: row.category.slug,
    published: row.published,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    variants: row.variants.map((variant) => ({ ...variant })),
    localizations: row.localizations.map(toLocalizationView),
  };
}

export async function listAdminProducts(): Promise<AdminProductView[]> {
  const rows = await prisma.product.findMany({
    include: {
      category: { select: { slug: true } },
      variants: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
      localizations: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(toProductView);
}

export async function getAdminProduct(id: string): Promise<AdminProductView | null> {
  const row = await prisma.product.findUnique({
    where: { id },
    include: {
      category: { select: { slug: true } },
      variants: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
      localizations: true,
    },
  });
  return row ? toProductView(row) : null;
}

export async function listAdminCategories(): Promise<AdminCategoryView[]> {
  const rows = await prisma.category.findMany({
    include: { localizations: true },
    orderBy: { sortOrder: 'asc' },
  });
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    names: Object.fromEntries(row.localizations.map((loc) => [loc.locale, loc.name])),
  }));
}
