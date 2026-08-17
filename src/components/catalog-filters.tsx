/**
 * Catalog filter bar — a plain GET form, so every submission lands in the URL
 * with no client JavaScript. All controls are native (keyboard-accessible),
 * labels are localized, and the search page and the products page share the
 * exact same form (ADR-0004).
 */
import Link from 'next/link';
import type { Translator } from '@/i18n/catalog';
import type { MessageKey } from '@/i18n/messages/en';
import type { LocaleId } from '@/i18n/registry';
import { buildCatalogUrl, type CatalogBase, type CatalogParams } from '@/lib/catalog-params';
import {
  CAFFEINE_LEVELS,
  CATALOG_SORTS,
  PRODUCT_FORMS,
} from '@/lib/catalog-options';
import type { CategoryView, CatalogSortId } from '@/lib/products';

const INPUT_CLASS =
  'w-full rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-sm text-stone-800 shadow-sm placeholder:text-stone-400 focus:border-pine-500 focus:outline-none focus:ring-2 focus:ring-pine-200';

// URL sort ids are kebab-case (price-asc) while message keys use camelCase
// suffixes (priceAsc); keep the mapping explicit and type-safe.
const SORT_LABEL_KEYS: Record<CatalogSortId, MessageKey> = {
  featured: 'catalog.sort.featured',
  'price-asc': 'catalog.sort.priceAsc',
  'price-desc': 'catalog.sort.priceDesc',
  'name-asc': 'catalog.sort.nameAsc',
};

interface CatalogFiltersProps {
  locale: LocaleId;
  t: Translator;
  base: CatalogBase;
  params: CatalogParams;
  categories: CategoryView[];
}

function hasActiveFilters(params: CatalogParams): boolean {
  return Boolean(
    params.q ||
      params.category ||
      params.form ||
      params.caffeine ||
      params.priceMinYuan !== undefined ||
      params.priceMaxYuan !== undefined ||
      params.inStock !== undefined ||
      (params.sort !== undefined && params.sort !== 'featured'),
  );
}

export function CatalogFilters({ locale, t, base, params, categories }: CatalogFiltersProps) {
  const clearHref = buildCatalogUrl(locale, base, {});
  const fieldClass = 'flex w-full flex-col gap-1 text-xs font-medium text-stone-600 sm:w-auto sm:min-w-40';

  return (
    <section
      aria-labelledby="catalog-filters-title"
      className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="catalog-filters-title" className="font-serif text-sm font-semibold text-pine-900">
          {t('catalog.filterTitle')}
        </h2>
        {hasActiveFilters(params) && (
          <Link
            href={clearHref}
            className="text-xs text-pine-700 underline decoration-stone-300 underline-offset-2 hover:text-pine-800"
            data-testid="clear-filters"
          >
            {t('catalog.clearFilters')}
          </Link>
        )}
      </div>

      <form
        action={`/${locale}/${base}`}
        method="get"
        data-testid="catalog-filters"
        className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-3"
      >
        <label className={`${fieldClass} sm:min-w-56`}>
          {t('catalog.queryLabel')}
          <input
            type="search"
            name="q"
            maxLength={200}
            defaultValue={params.q ?? ''}
            placeholder={t('home.searchPlaceholder')}
            data-testid="catalog-query"
            className={INPUT_CLASS}
          />
        </label>

        <label className={fieldClass}>
          {t('catalog.categoryLabel')}
          <select name="category" defaultValue={params.category ?? ''} className={INPUT_CLASS}>
            <option value="">{t('catalog.any')}</option>
            {categories.map((category) => (
              <option key={category.slug} value={category.slug}>
                {category.name}
              </option>
            ))}
          </select>
        </label>

        <label className={fieldClass}>
          {t('catalog.formLabel')}
          <select name="form" defaultValue={params.form ?? ''} className={INPUT_CLASS}>
            <option value="">{t('catalog.any')}</option>
            {PRODUCT_FORMS.map((id) => (
              <option key={id} value={id}>
                {t(`catalog.form.${id}` as MessageKey)}
              </option>
            ))}
          </select>
        </label>

        <label className={fieldClass}>
          {t('catalog.caffeineLabel')}
          <select name="caffeine" defaultValue={params.caffeine ?? ''} className={INPUT_CLASS}>
            <option value="">{t('catalog.any')}</option>
            {CAFFEINE_LEVELS.map((id) => (
              <option key={id} value={id}>
                {t(`catalog.caffeine.${id}` as MessageKey)}
              </option>
            ))}
          </select>
        </label>

        <label className={`${fieldClass} sm:w-32`}>
          {t('catalog.priceMinLabel')}
          <input
            type="number"
            name="priceMin"
            min={0}
            step={1}
            inputMode="numeric"
            defaultValue={params.priceMinYuan ?? ''}
            className={INPUT_CLASS}
          />
        </label>

        <label className={`${fieldClass} sm:w-32`}>
          {t('catalog.priceMaxLabel')}
          <input
            type="number"
            name="priceMax"
            min={0}
            step={1}
            inputMode="numeric"
            defaultValue={params.priceMaxYuan ?? ''}
            className={INPUT_CLASS}
          />
        </label>

        <label className={fieldClass}>
          {t('catalog.availabilityLabel')}
          <select name="inStock" defaultValue={params.inStock === undefined ? '' : String(params.inStock)} className={INPUT_CLASS}>
            <option value="">{t('catalog.any')}</option>
            <option value="true">{t('catalog.availability.inStock')}</option>
            <option value="false">{t('catalog.availability.outOfStock')}</option>
          </select>
        </label>

        <label className={fieldClass}>
          {t('catalog.sortLabel')}
          <select name="sort" defaultValue={params.sort ?? 'featured'} className={INPUT_CLASS}>
            {CATALOG_SORTS.map((id) => (
              <option key={id} value={id}>
                {t(SORT_LABEL_KEYS[id])}
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          className="shrink-0 rounded-md bg-pine-700 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-pine-800"
          data-testid="apply-filters"
        >
          {t('catalog.applyFilters')}
        </button>
      </form>

      {params.priceRangeInvalid && (
        <p
          role="alert"
          data-testid="price-range-invalid"
          className="mt-3 text-xs leading-relaxed text-lacquer-700"
        >
          {t('catalog.invalidPriceRange')}
        </p>
      )}
    </section>
  );
}
