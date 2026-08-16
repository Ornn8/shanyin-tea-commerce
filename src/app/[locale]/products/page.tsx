import { notFound } from 'next/navigation';
import { createT } from '@/i18n/catalog';
import { isLocaleId, type LocaleId } from '@/i18n/registry';
import { parseCatalogParams, toCatalogQuery } from '@/lib/catalog-params';
import { listCategories, queryProducts } from '@/lib/products';
import { CatalogBrowser } from '@/components/catalog-browser';
import { CategoryShortcuts } from '@/components/category-shortcuts';

export const dynamic = 'force-dynamic';

interface ProductsPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ProductsPage({ params, searchParams }: ProductsPageProps) {
  const { locale: raw } = await params;
  if (!isLocaleId(raw)) notFound();
  const locale: LocaleId = raw;
  const t = createT(locale);

  const parsed = parseCatalogParams(await searchParams);
  const [categories, result] = await Promise.all([
    listCategories(locale),
    queryProducts(toCatalogQuery(locale, parsed)),
  ]);
  const activeCategory = parsed.category
    ? categories.find((category) => category.slug === parsed.category)
    : undefined;

  return (
    <div className="flex flex-col gap-6 py-8">
      <CategoryShortcuts categories={categories} locale={locale} params={parsed} />
      <CatalogBrowser
        locale={locale}
        t={t}
        base="products"
        categories={categories}
        params={parsed}
        result={result}
        title={activeCategory ? activeCategory.name : t('nav.products')}
      />
    </div>
  );
}
