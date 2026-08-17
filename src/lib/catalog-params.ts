/**
 * Catalog discovery URL contract (ADR-0004).
 *
 * Every discovery input — search query, filters, sort, and page — is encoded
 * in the URL query string, so results are shareable and survive refresh,
 * back/forward navigation, and locale switching (the locale lives in the path
 * segment, which the locale picker swaps in place).
 *
 * Validation is deterministic: unknown or malformed parameter values are
 * ignored (treated as absent), never crash the page. A price range whose
 * minimum exceeds its maximum is rejected as a whole and surfaced through
 * `priceRangeInvalid` so the UI can show a localized notice.
 */
import type { LocaleId } from '@/i18n/registry';
import type { CatalogQuery } from './products';
import {
  CAFFEINE_LEVELS,
  CATALOG_SORTS,
  PRODUCT_FORMS,
  type CaffeineLevelId,
  type CatalogSortId,
  type ProductFormId,
} from './catalog-options';

export type CatalogBase = 'products' | 'search';

export interface CatalogParams {
  /** Trimmed, length-capped free-text query (matched against the active locale's copy). */
  q?: string;
  /** Category (tea family) slug, e.g. `dark-tea`. */
  category?: string;
  /** Leaf form id: `loose` | `compressed`. */
  form?: ProductFormId;
  /** Caffeine id: `low` | `medium` | `high`. */
  caffeine?: CaffeineLevelId;
  /** Inclusive minimum price in whole CNY yuan (integer). */
  priceMinYuan?: number;
  /** Inclusive maximum price in whole CNY yuan (integer). */
  priceMaxYuan?: number;
  /** Availability: `true` = in stock only, `false` = out of stock only. */
  inStock?: boolean;
  /** Sort id; omitted or `featured` = default ranking. */
  sort?: CatalogSortId;
  /** 1-based page number; omitted = page 1. */
  page?: number;
  /** True when the price range was rejected (min > max); the UI shows a localized notice. */
  priceRangeInvalid: boolean;
}

export const MAX_QUERY_LENGTH = 200;

type RawSearchParams = Record<string, string | string[] | undefined>;

function firstValue(raw: RawSearchParams, key: string): string | undefined {
  const value = raw[key];
  if (Array.isArray(value)) return value[0];
  return value;
}

/** Whole non-negative CNY yuan, or undefined when malformed. */
function parsePrice(raw: RawSearchParams, key: string): number | undefined {
  const value = firstValue(raw, key)?.trim();
  if (value === undefined || value === '') return undefined;
  if (!/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export function parseCatalogParams(raw: RawSearchParams): CatalogParams {
  const q = firstValue(raw, 'q')?.trim().slice(0, MAX_QUERY_LENGTH);
  const category = firstValue(raw, 'category')?.trim();
  const formRaw = firstValue(raw, 'form');
  const caffeineRaw = firstValue(raw, 'caffeine');
  const inStockRaw = firstValue(raw, 'inStock');
  const sortRaw = firstValue(raw, 'sort');
  const pageRaw = firstValue(raw, 'page');

  const form =
    formRaw !== undefined && (PRODUCT_FORMS as readonly string[]).includes(formRaw)
      ? (formRaw as ProductFormId)
      : undefined;
  const caffeine =
    caffeineRaw !== undefined && (CAFFEINE_LEVELS as readonly string[]).includes(caffeineRaw)
      ? (caffeineRaw as CaffeineLevelId)
      : undefined;
  const inStock = inStockRaw === 'true' ? true : inStockRaw === 'false' ? false : undefined;
  const sort =
    sortRaw !== undefined && (CATALOG_SORTS as readonly string[]).includes(sortRaw)
      ? (sortRaw as CatalogSortId)
      : undefined;
  const page = pageRaw !== undefined && /^\d+$/.test(pageRaw.trim()) ? Number(pageRaw) : undefined;

  const priceMinYuan = parsePrice(raw, 'priceMin');
  const priceMaxYuan = parsePrice(raw, 'priceMax');
  const priceRangeInvalid =
    priceMinYuan !== undefined && priceMaxYuan !== undefined && priceMinYuan > priceMaxYuan;

  return {
    q: q || undefined,
    category: category || undefined,
    form,
    caffeine,
    inStock,
    sort,
    page,
    priceMinYuan: priceRangeInvalid ? undefined : priceMinYuan,
    priceMaxYuan: priceRangeInvalid ? undefined : priceMaxYuan,
    priceRangeInvalid,
  };
}

/**
 * Build a canonical catalog URL for the given locale, page base, and params:
 * default values (`page` 1, `sort` featured) and invalid entries are omitted,
 * so identical results always share one URL form.
 */
export function buildCatalogUrl(
  locale: LocaleId,
  base: CatalogBase,
  params: Partial<CatalogParams>,
): string {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.category) search.set('category', params.category);
  if (params.form) search.set('form', params.form);
  if (params.caffeine) search.set('caffeine', params.caffeine);
  if (params.priceMinYuan !== undefined && !params.priceRangeInvalid) {
    search.set('priceMin', String(params.priceMinYuan));
  }
  if (params.priceMaxYuan !== undefined && !params.priceRangeInvalid) {
    search.set('priceMax', String(params.priceMaxYuan));
  }
  if (params.inStock !== undefined) search.set('inStock', String(params.inStock));
  if (params.sort && params.sort !== 'featured') search.set('sort', params.sort);
  if (params.page && params.page > 1) search.set('page', String(params.page));
  const query = search.toString();
  return `/${locale}/${base}${query ? `?${query}` : ''}`;
}

/**
 * Map validated URL params onto the discovery query the server executes.
 * Price bounds are converted from whole CNY yuan to integer cents — the
 * filter always operates on the language-neutral `priceCents` fact.
 */
export function toCatalogQuery(locale: LocaleId, params: CatalogParams): CatalogQuery {
  return {
    locale,
    q: params.q,
    category: params.category,
    form: params.form,
    caffeine: params.caffeine,
    priceMinCents: params.priceMinYuan !== undefined ? params.priceMinYuan * 100 : undefined,
    priceMaxCents: params.priceMaxYuan !== undefined ? params.priceMaxYuan * 100 : undefined,
    inStock: params.inStock,
    sort: params.sort,
    page: params.page,
  };
}
