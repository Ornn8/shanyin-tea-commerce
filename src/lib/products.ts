/**
 * Catalog access layer.
 *
 * - `listProducts` / `getProductBySlug` / `getProductsBySkus` / `listCategories`
 *   serve the home page, detail page, and cart.
 * - `queryProducts` is the server-backed discovery engine behind the catalog
 *   result pages (`/…/products` and `/…/search`). Its full contract — URL
 *   parameters, locale-scoped search with a deterministic fallback,
 *   language-neutral fact filters, sorting, and pagination — is documented in
 *   docs/adr/0004-catalog-discovery-url-state.md.
 *
 * Commerce facts (slugs, SKUs, priceCents, inventory, origin, leaf form,
 * caffeine level) are language-neutral; only product copy is localized and
 * picked per locale (ADR-0003).
 */
import { prisma } from '@/lib/prisma';
import { FALLBACK_LOCALE, type LocaleId } from '@/i18n/registry';
import {
  CAFFEINE_LEVELS,
  CATALOG_PAGE_SIZE,
  CATALOG_SORTS,
  PRODUCT_FORMS,
  type CaffeineLevelId,
  type CatalogSortId,
  type ProductFormId,
} from './catalog-options';

export {
  CAFFEINE_LEVELS,
  CATALOG_PAGE_SIZE,
  CATALOG_SORTS,
  PRODUCT_FORMS,
  type CaffeineLevelId,
  type CatalogSortId,
  type ProductFormId,
};

/** DB enum → canonical URL id. */
const FORM_FROM_ENUM: Readonly<Record<string, ProductFormId>> = {
  LOOSE: 'loose',
  COMPRESSED: 'compressed',
};

/** DB enum → canonical URL id. */
const CAFFEINE_FROM_ENUM: Readonly<Record<string, CaffeineLevelId>> = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
};

export interface ProductView {
  id: string;
  slug: string;
  sku: string;
  priceCents: number;
  inventory: number;
  origin: string;
  form: ProductFormId;
  caffeine: CaffeineLevelId;
  name: string;
  description: string;
  tastingNotes: string;
  category: { slug: string; name: string };
  /** Language-neutral ranking input (createdAt ascending = featured order). */
  createdAt: Date;
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

/**
 * The variant a shopper sees: the product's first-created variant. The
 * storefront intentionally reads language-neutral facts (SKU, integer-cents
 * price, inventory) from variants only (ADR-0005); unpublished products are
 * never returned.
 */
function primaryVariant(row: ProductRow) {
  return row.variants[0];
}

export function toProductView(row: ProductRow, locale: LocaleId): ProductView {
  const loc = pickLocalization(row.localizations, locale);
  const catLoc = pickLocalization(row.category.localizations, locale);
  const variant = primaryVariant(row);
  return {
    id: row.id,
    slug: row.slug,
    sku: variant?.sku ?? '',
    priceCents: variant?.priceCents ?? 0,
    inventory: variant?.inventory ?? 0,
    origin: row.origin,
    form: FORM_FROM_ENUM[row.form] ?? 'loose',
    caffeine: CAFFEINE_FROM_ENUM[row.caffeine] ?? 'medium',
    name: loc?.name ?? row.slug,
    description: loc?.description ?? '',
    tastingNotes: loc?.tastingNotes ?? '',
    category: { slug: row.category.slug, name: catLoc?.name ?? row.category.slug },
    createdAt: row.createdAt,
  };
}

function findProductRow() {
  return prisma.product.findMany({
    // Only published products exist on the storefront (ADR-0005).
    where: { published: true },
    include: {
      localizations: true,
      category: { include: { localizations: true } },
      variants: { orderBy: { createdAt: 'asc' } },
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
    where: { slug, published: true },
    include: {
      localizations: true,
      category: { include: { localizations: true } },
      variants: { orderBy: { createdAt: 'asc' } },
    },
  });
  return row ? toProductView(row, locale) : null;
}

export async function getProductsBySkus(skus: string[], locale: LocaleId): Promise<ProductView[]> {
  if (skus.length === 0) return [];
  const rows = await prisma.product.findMany({
    where: { published: true, variants: { some: { sku: { in: skus } } } },
    include: {
      localizations: true,
      category: { include: { localizations: true } },
      variants: { orderBy: { createdAt: 'asc' } },
    },
  });
  const bySku = new Map<string, ProductView>();
  for (const row of rows) {
    const view = toProductView(row, locale);
    for (const variant of row.variants) {
      bySku.set(variant.sku, view);
    }
  }
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

export interface CatalogQuery {
  locale: LocaleId;
  /** Free-text query, matched against the copy the page displays for this locale. */
  q?: string;
  /** Category slug (tea family). */
  category?: string;
  /** Leaf form id. */
  form?: ProductFormId;
  /** Caffeine id. */
  caffeine?: CaffeineLevelId;
  /** Inclusive lower price bound in integer cents. */
  priceMinCents?: number;
  /** Inclusive upper price bound in integer cents. */
  priceMaxCents?: number;
  /** `true` = in stock only (inventory > 0), `false` = out of stock only (inventory === 0). */
  inStock?: boolean;
  /** Sort id; default `featured`. */
  sort?: CatalogSortId;
  /** 1-based page; out-of-range pages clamp to the last page. */
  page?: number;
  /** Page size; default CATALOG_PAGE_SIZE. Not part of the URL contract. */
  pageSize?: number;
}

export interface CatalogResult {
  /** The current page's products, in the applied sort order. */
  products: ProductView[];
  /** Total matches before pagination. */
  total: number;
  /** Effective 1-based page (clamped into range). */
  page: number;
  pageSize: number;
  /** Effective page count (at least 1). */
  pageCount: number;
}

/**
 * Server-backed discovery query: locale-scoped search, fact filters, sort,
 * and stable pagination (ADR-0004).
 *
 * Search matches the SAME copy the page renders for the active locale: the
 * requested locale's localization row, falling back deterministically to
 * English, then to any available row (the ADR-0003 pick order). A product
 * whose effective copy is English is therefore found by its English text in
 * every locale that lacks its own row — never by another locale's rows when
 * its own copy exists.
 *
 * Price and inventory filters operate on the language-neutral facts
 * (`priceCents`, `inventory`), never on localized display strings.
 *
 * The demo catalog is small, so filtering and pagination run in memory on
 * one deterministic query; ADR-0004 records the trigger for moving these
 * predicates into SQL when the catalog grows.
 */
export async function queryProducts(query: CatalogQuery): Promise<CatalogResult> {
  const locale = query.locale;
  const pageSize =
    query.pageSize !== undefined && Number.isSafeInteger(query.pageSize) && query.pageSize > 0
      ? query.pageSize
      : CATALOG_PAGE_SIZE;
  const requestedPage =
    query.page !== undefined && Number.isSafeInteger(query.page) && query.page > 0
      ? query.page
      : 1;

  const rows = await findProductRow();
  const q = (query.q ?? '').trim().toLocaleLowerCase();

  const matched = rows.filter((row) => {
    const variant = primaryVariant(row);
    if (q) {
      const loc = pickLocalization(row.localizations, locale);
      const name = (loc?.name ?? '').toLocaleLowerCase();
      const description = (loc?.description ?? '').toLocaleLowerCase();
      if (!name.includes(q) && !description.includes(q)) return false;
    }
    if (query.category !== undefined && row.category.slug !== query.category) return false;
    if (query.form !== undefined && FORM_FROM_ENUM[row.form] !== query.form) return false;
    if (query.caffeine !== undefined && CAFFEINE_FROM_ENUM[row.caffeine] !== query.caffeine) {
      return false;
    }
    // Price and availability filters operate on the language-neutral variant
    // facts (integer cents, per-variant inventory) — never on display strings.
    if (query.priceMinCents !== undefined && (variant?.priceCents ?? 0) < query.priceMinCents) {
      return false;
    }
    if (query.priceMaxCents !== undefined && (variant?.priceCents ?? 0) > query.priceMaxCents) {
      return false;
    }
    if (query.inStock !== undefined && ((variant?.inventory ?? 0) > 0) !== query.inStock) {
      return false;
    }
    return true;
  });

  let views = matched.map((row) => toProductView(row, locale));
  views = sortViews(views, query.sort ?? 'featured', locale);

  const total = views.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, requestedPage), pageCount);
  const start = (page - 1) * pageSize;
  return {
    products: views.slice(start, start + pageSize),
    total,
    page,
    pageSize,
    pageCount,
  };
}

function sortViews(views: ProductView[], sort: CatalogSortId, locale: LocaleId): ProductView[] {
  const sorted = [...views];
  switch (sort) {
    case 'price-asc':
      sorted.sort((a, b) => a.priceCents - b.priceCents || a.slug.localeCompare(b.slug));
      break;
    case 'price-desc':
      sorted.sort((a, b) => b.priceCents - a.priceCents || a.slug.localeCompare(b.slug));
      break;
    case 'name-asc':
      // Display sort over the localized name; collation follows the active locale.
      sorted.sort((a, b) => a.name.localeCompare(b.name, locale) || a.slug.localeCompare(b.slug));
      break;
    case 'featured':
    default:
      // Default ranking input is language-neutral: createdAt ascending, then slug.
      sorted.sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.slug.localeCompare(b.slug),
      );
      break;
  }
  return sorted;
}
