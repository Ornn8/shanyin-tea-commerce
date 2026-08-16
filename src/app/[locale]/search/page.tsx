import { notFound } from 'next/navigation';
import { createT } from '@/i18n/catalog';
import { isLocaleId, type LocaleId } from '@/i18n/registry';
import { searchProducts } from '@/lib/products';
import { ProductGrid } from '@/components/product-grid';

export const dynamic = 'force-dynamic';

interface SearchPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string }>;
}

export default async function SearchPage({ params, searchParams }: SearchPageProps) {
  const { locale: raw } = await params;
  if (!isLocaleId(raw)) notFound();
  const locale: LocaleId = raw;
  const t = createT(locale);

  const { q } = await searchParams;
  const query = (q ?? '').trim();
  const products = await searchProducts(query, locale);

  return (
    <div className="flex flex-col gap-6 py-8">
      <h1 className="font-serif text-2xl font-semibold text-pine-900" data-testid="search-title">
        {t('search.title')}
      </h1>
      {query ? (
        <p className="text-sm text-stone-600" data-testid="search-summary">
          {t('search.resultsFor', { query })}
        </p>
      ) : (
        <p className="text-sm text-stone-500">{t('search.allProducts')}</p>
      )}
      <ProductGrid
        products={products}
        locale={locale}
        t={t}
        empty={query ? t('search.noResults', { query }) : undefined}
      />
    </div>
  );
}
