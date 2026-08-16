import { prisma } from '@/lib/prisma';
import { FALLBACK_LOCALE, type LocaleId } from '@/i18n/registry';

export interface ProductView {
  id: string;
  slug: string;
  sku: string;
  priceCents: number;
  inventory: number;
  origin: string;
  name: string;
  description: string;
  tastingNotes: string;
  category: { slug: string; name: string };
}

type ProductRow = Awaited<ReturnType<typeof findProductRow>>[number];

function pickLocalization<T extends { locale: string }>(
  items: T[],
  locale: LocaleId,
): T | undefined {
  return (
    items.find((item) => item.locale === locale) ??
    items.find((item) => item.locale === FALLBACK_LOCALE) ??
    items[0]
  );
}

export function toProductView(row: ProductRow, locale: LocaleId): ProductView {
  const loc = pickLocalization(row.localizations, locale);
  const catLoc = pickLocalization(row.category.localizations, locale);
  return {
    id: row.id,
    slug: row.slug,
    sku: row.sku,
    priceCents: row.priceCents,
    inventory: row.inventory,
    origin: row.origin,
    name: loc?.name ?? row.slug,
    description: loc?.description ?? '',
    tastingNotes: loc?.tastingNotes ?? '',
    category: { slug: row.category.slug, name: catLoc?.name ?? row.category.slug },
  };
}

function findProductRow() {
  return prisma.product.findMany({
    include: {
      localizations: true,
      category: { include: { localizations: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
}

export async function listProducts(locale: LocaleId): Promise<ProductView[]> {
  const rows = await findProductRow();
  return rows.map((row) => toProductView(row, locale));
}

export async function getProductBySlug(slug: string, locale: LocaleId): Promise<ProductView | null> {
  const row = await prisma.product.findUnique({
    where: { slug },
    include: {
      localizations: true,
      category: { include: { localizations: true } },
    },
  });
  return row ? toProductView(row, locale) : null;
}

export async function getProductsBySkus(skus: string[], locale: LocaleId): Promise<ProductView[]> {
  if (skus.length === 0) return [];
  const rows = await prisma.product.findMany({
    where: { sku: { in: skus } },
    include: {
      localizations: true,
      category: { include: { localizations: true } },
    },
  });
  const bySku = new Map(rows.map((row) => [row.sku, toProductView(row, locale)]));
  // Preserve cart order.
  return skus.flatMap((sku) => (bySku.get(sku) ? [bySku.get(sku)!] : []));
}

export interface CategoryView {
  slug: string;
  name: string;
  productCount: number;
}

export async function listCategories(locale: LocaleId): Promise<CategoryView[]> {
  const rows = await prisma.category.findMany({
    include: {
      localizations: true,
      _count: { select: { products: true } },
    },
    orderBy: { sortOrder: 'asc' },
  });
  return rows.map((row) => {
    const loc = pickLocalization(row.localizations, locale);
    return {
      slug: row.slug,
      name: loc?.name ?? row.slug,
      productCount: row._count.products,
    };
  });
}

export async function searchProducts(query: string, locale: LocaleId): Promise<ProductView[]> {
  const trimmed = query.trim();
  if (!trimmed) return listProducts(locale);
  const rows = await prisma.product.findMany({
    where: {
      localizations: {
        some: {
          OR: [
            { name: { contains: trimmed, mode: 'insensitive' } },
            { description: { contains: trimmed, mode: 'insensitive' } },
          ],
        },
      },
    },
    include: {
      localizations: true,
      category: { include: { localizations: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((row) => toProductView(row, locale));
}
