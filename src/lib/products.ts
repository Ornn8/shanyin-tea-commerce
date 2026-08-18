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
import { effectiveField, type LocalizedRow } from '@/lib/admin/preview';
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
 * The variant a shopper sees: the product's default variant — position 0 in
 * the persisted variant order, with createdAt/id as deterministic secondary
 * keys (ADR-0006; `createdAt` alone ties for transaction-co-created rows, so
 * an explicit `position` is persisted by every write path). The storefront
 * intentionally reads language-neutral facts (SKU, integer-cents price,
 * inventory) from variants only (ADR-0005); unpublished products are never
 * returned.
 */
function primaryVariant(row: ProductRow) {
  return row.variants[0];
}

export function toProductView(row: ProductRow, locale: LocaleId): ProductView {
  // Field-level English fallback (ADR-0003/0005), the same deterministic
  // semantics the merchant editor previews: the locale's own value when it is
  // filled, else English, else any row, else the slug/empty. A locale row may
  // legally store an empty description or tasting notes (the publication gate
  // requires English copy only), so the storefront must render the English
  // fallback instead of returning the blank string — otherwise published
  // zh-CN / ja pages show blank copy that the merchant preview advertised as
  // falling back to English.
  const rows = row.localizations as LocalizedRow[];
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
    name: effectiveField(rows, locale, 'name', row.slug),
    description: effectiveField(rows, locale, 'description'),
    tastingNotes: effectiveField(rows, locale, 'tastingNotes'),
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
      variants: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
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
      variants: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
    },
  });
  return row ? toProductView(row, locale) : null;
}

// ---------------------------------------------------------------------------
// Product detail (Issue #4, ADR-0006)
// ---------------------------------------------------------------------------

/** One sellable unit as the storefront detail page presents it. */
export interface StorefrontVariantView {
  id: string;
  /** Globally unique, language-neutral SKU. */
  sku: string;
  /** Shared display name (e.g. package size); not localized copy (ADR-0005). */
  name: string;
  priceCents: number;
  inventory: number;
}

export interface ProductDetailView extends ProductView {
  /** All published variants in persisted position order (variant 0 = default). */
  variants: StorefrontVariantView[];
  /** Brewing guidance — effective value with the ADR-0003/0005 fallback. */
  brewingNotes: string;
  /** Effective localized media alt text, or null when none is stored. */
  mediaAlt: string | null;
  /** Effective localized SEO title, or null (metadata falls back to name). */
  seoTitle: string | null;
  /** Effective localized SEO description, or null. */
  seoDescription: string | null;
}

function toDetailViewForLocale(
  row: NonNullable<Awaited<ReturnType<typeof findRowBySlug>>>,
  locale: LocaleId,
): ProductDetailView {
  const base = toProductView(row, locale);
  const rows = row.localizations as LocalizedRow[];
  const filled = (value: string) => (value.trim().length > 0 ? value : null);
  return {
    ...base,
    variants: row.variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      name: variant.name,
      priceCents: variant.priceCents,
      inventory: variant.inventory,
    })),
    brewingNotes: effectiveField(rows, locale, 'brewingNotes'),
    mediaAlt: filled(effectiveField(rows, locale, 'mediaAlt')),
    seoTitle: filled(effectiveField(rows, locale, 'seoTitle')),
    seoDescription: filled(effectiveField(rows, locale, 'seoDescription')),
  };
}

function findRowBySlug(slug: string) {
  return prisma.product.findUnique({
    where: { slug, published: true },
    include: {
      localizations: true,
      category: { include: { localizations: true } },
      variants: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
    },
  });
}

/** Full detail-page view: every variant plus localized brewing/SEO/media copy. */
export async function getProductDetail(
  slug: string,
  locale: LocaleId,
): Promise<ProductDetailView | null> {
  const row = await findRowBySlug(slug);
  return row ? toDetailViewForLocale(row, locale) : null;
}

export interface RelatedProductQuery {
  slug: string;
  locale: LocaleId;
  /** Maximum number of recommendations. */
  limit?: number;
}

/**
 * Deterministic recommendations: published products only (never unpublished),
 * same category first, then the rest of the catalog, excluding the current
 * product — each product once, never duplicated by locale (product facts are
 * language-neutral and rows are filtered at the product level, ADR-0003).
 */
export async function getRelatedProducts(query: RelatedProductQuery): Promise<ProductView[]> {
  const limit = query.limit !== undefined && Number.isSafeInteger(query.limit) && query.limit > 0
    ? query.limit
    : 3;
  const rows = await findProductRow();
  const current = rows.find((row) => row.slug === query.slug);
  if (!current) return [];
  const others = rows.filter((row) => row.slug !== query.slug);
  const sameCategory = others.filter((row) => row.categoryId === current.categoryId);
  const rest = others.filter((row) => row.categoryId !== current.categoryId);
  const ordered = [...sameCategory, ...rest].slice(0, limit);
  return ordered.map((row) => toProductView(row, query.locale));
}

export interface CartLine {
  /** Product display view (localized copy via the shared fallback). */
  product: ProductView;
  /** The exact variant the shopper added (SKU, price, inventory). */
  variant: StorefrontVariantView;
}

/**
 * Resolve cart SKUs to the exact variant added. The cart cookie stores SKUs
 * — language-neutral identifiers — so a variant's own price, name, and stock
 * are honored per line (a 250g variant shows its own price, never the
 * product's default variant price). Unpublished products and unknown SKUs are
 * silently dropped; order follows the cookie.
 */
export async function getCartLines(skus: string[], locale: LocaleId): Promise<CartLine[]> {
  if (skus.length === 0) return [];
  const rows = await prisma.product.findMany({
    where: { published: true, variants: { some: { sku: { in: skus } } } },
    include: {
      localizations: true,
      category: { include: { localizations: true } },
      variants: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
    },
  });
  const bySku = new Map<string, CartLine>();
  for (const row of rows) {
    const product = toProductView(row, locale);
    for (const variant of row.variants) {
      if (!skus.includes(variant.sku)) continue;
      bySku.set(variant.sku, {
        product,
        variant: {
          id: variant.id,
          sku: variant.sku,
          name: variant.name,
          priceCents: variant.priceCents,
          inventory: variant.inventory,
        },
      });
    }
  }
  return skus.flatMap((sku) => (bySku.get(sku) ? [bySku.get(sku)!] : []));
}

export async function getProductsBySkus(skus: string[], locale: LocaleId): Promise<ProductView[]> {
  if (skus.length === 0) return [];
  const rows = await prisma.product.findMany({
    where: { published: true, variants: { some: { sku: { in: skus } } } },
    include: {
      localizations: true,
      category: { include: { localizations: true } },
      variants: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
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
 * Search matches the SAME copy the page renders for the active locale: each
 * name/description field resolves through the deterministic ADR-0003/0005
 * pick order (requested locale → English → any row), so a locale whose stored
 * copy is empty but displays the English fallback is found by its English
 * text in every locale that lacks its own copy — never by another locale's
 * rows when its own effective copy exists.
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
      // Match the SAME copy the page renders: the effective field-level value
      // (own locale → English → any row), so a locale whose stored description
      // is empty but displays the English fallback is found by its English text.
      const rowsForLocale = row.localizations as LocalizedRow[];
      const name = effectiveField(rowsForLocale, locale, 'name', '').toLocaleLowerCase();
      const description = effectiveField(rowsForLocale, locale, 'description', '').toLocaleLowerCase();
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
