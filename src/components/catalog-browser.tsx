/**
 * Catalog browser — the shared server-backed discovery view behind both the
 * catalog page (`/…/products`) and the search results page (`/…/search`).
 * Title and summary differ per page; filters, result count, grid, empty
 * state, and pagination are identical (ADR-0004).
 */
import type { ReactNode } from 'react';
import type { Translator } from '@/i18n/catalog';
import type { LocaleId } from '@/i18n/registry';
import type { CatalogBase, CatalogParams } from '@/lib/catalog-params';
import type { CatalogResult, CategoryView } from '@/lib/products';
import { CatalogFilters } from './catalog-filters';
import { CatalogPagination } from './catalog-pagination';
import { ProductGrid } from './product-grid';

interface CatalogBrowserProps {
  locale: LocaleId;
  t: Translator;
  base: CatalogBase;
  categories: CategoryView[];
  params: CatalogParams;
  result: CatalogResult;
  /** Localized page heading (e.g. "Catalog" or "Search"). */
  title: string;
  /** Optional localized line under the heading (e.g. "Results for …"). */
  summary?: ReactNode;
}

export function CatalogBrowser({
  locale,
  t,
  base,
  categories,
  params,
  result,
  title,
  summary,
}: CatalogBrowserProps) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-semibold text-pine-900 sm:text-3xl">{title}</h1>
        {summary}
        <p className="text-sm text-stone-500" data-testid="catalog-count">
          {t('catalog.resultsCount', { count: String(result.total) })} · {t('common.demoBadge')}
        </p>
      </div>

      <CatalogFilters locale={locale} t={t} base={base} params={params} categories={categories} />

      <ProductGrid
        products={result.products}
        locale={locale}
        t={t}
        empty={t('catalog.emptyState')}
      />

      <CatalogPagination locale={locale} t={t} base={base} params={params} result={result} />
    </div>
  );
}
