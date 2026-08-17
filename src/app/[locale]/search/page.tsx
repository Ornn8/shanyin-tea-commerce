import { notFound } from 'next/navigation';
import { createT } from '@/i18n/catalog';
import { isLocaleId, type LocaleId } from '@/i18n/registry';
import { parseCatalogParams, toCatalogQuery } from '@/lib/catalog-params';
import { listCategories, queryProducts } from '@/lib/products';
import { CatalogBrowser } from '@/components/catalog-browser';

export const dynamic = 'force-dynamic';

interface SearchPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SearchPage({ params, searchParams }: SearchPageProps) {
  const { locale: raw } = await params;
  if (!isLocaleId(raw)) notFound();
  const locale: LocaleId = raw;
  const t = createT(locale);

  const parsed = parseCatalogParams(await searchParams);
  const [categories, result] = await Promise.all([
    listCategories(locale),
    queryProducts(toCatalogQuery(locale, parsed)),
  ]);

  return (
    <div className="flex flex-col gap-6 py-8">
      <CatalogBrowser
        locale={locale}
        t={t}
        base="search"
        categories={categories}
        params={parsed}
        result={result}
        title={t('search.title')}
        summary={
          parsed.q ? (
            <p className="text-sm text-stone-600" data-testid="search-summary">
              {t('search.resultsFor', { query: parsed.q })}
            </p>
          ) : (
            <p className="text-sm text-stone-500">{t('search.allProducts')}</p>
          )
        }
      />
    </div>
  );
}
