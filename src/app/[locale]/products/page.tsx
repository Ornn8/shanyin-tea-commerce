import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createT } from '@/i18n/catalog';
import { isLocaleId, type LocaleId } from '@/i18n/registry';
import { listCategories, listProducts } from '@/lib/products';
import { CategoryShortcuts } from '@/components/category-shortcuts';
import { ProductGrid } from '@/components/product-grid';

export const dynamic = 'force-dynamic';

interface ProductsPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ category?: string }>;
}

export default async function ProductsPage({ params, searchParams }: ProductsPageProps) {
  const { locale: raw } = await params;
  if (!isLocaleId(raw)) notFound();
  const locale: LocaleId = raw;
  const t = createT(locale);

  const { category: categorySlug } = await searchParams;
  const [categories, allProducts] = await Promise.all([
    listCategories(locale),
    listProducts(locale),
  ]);
  const activeCategory = categorySlug
    ? categories.find((category) => category.slug === categorySlug)
    : undefined;
  const products = activeCategory
    ? allProducts.filter((product) => product.category.slug === activeCategory.slug)
    : allProducts;

  return (
    <div className="flex flex-col gap-6 py-8">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-pine-900 sm:text-3xl">
          {activeCategory ? activeCategory.name : t('nav.products')}
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          {products.length} · {t('common.demoBadge')}
        </p>
      </div>
      <CategoryShortcuts categories={categories} locale={locale} />
      {activeCategory && (
        <Link href={`/${locale}/products`} className="text-sm text-pine-700 hover:text-pine-800">
          ← {t('search.allProducts')}
        </Link>
      )}
      <ProductGrid products={products} locale={locale} t={t} />
    </div>
  );
}
