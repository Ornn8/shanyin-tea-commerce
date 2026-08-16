import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createT } from '@/i18n/catalog';
import { isLocaleId, type LocaleId } from '@/i18n/registry';
import { listCategories, listProducts } from '@/lib/products';
import { CategoryShortcuts } from '@/components/category-shortcuts';
import { ProductGrid } from '@/components/product-grid';
import { Seal } from '@/components/seal';

export const dynamic = 'force-dynamic';

interface HomePageProps {
  params: Promise<{ locale: string }>;
}

export default async function HomePage({ params }: HomePageProps) {
  const { locale: raw } = await params;
  if (!isLocaleId(raw)) notFound();
  const locale: LocaleId = raw;
  const t = createT(locale);
  const [categories, products] = await Promise.all([
    listCategories(locale),
    listProducts(locale),
  ]);

  return (
    <div className="flex flex-col gap-10 py-8">
      <p
        data-testid="demo-banner"
        className="rounded-md border border-lacquer-200 bg-lacquer-50 px-3 py-2 text-xs leading-relaxed text-lacquer-800"
      >
        {t('common.demoBanner')}
      </p>

      <section className="relative overflow-hidden rounded-xl border border-celadon-200 bg-celadon-50 px-6 py-10 sm:px-10 sm:py-14">
        <div
          aria-hidden="true"
          className="absolute -right-10 -top-10 hidden h-44 w-44 rotate-12 rounded-lg border-2 border-celadon-300/70 sm:block"
        />
        <Seal glyph="茶" label="Tea" className="mb-4 h-10 w-10 rounded-md -rotate-6" />
        <h1
          data-testid="hero-title"
          className="max-w-2xl font-serif text-3xl font-semibold leading-snug text-pine-900 sm:text-4xl"
        >
          {t('home.heroTitle')}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-stone-600 sm:text-base">
          {t('home.heroSubtitle')}
        </p>
        <Link
          href={`/${locale}/products`}
          className="mt-6 inline-flex rounded-md bg-pine-700 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-pine-800"
        >
          {t('home.heroCta')}
        </Link>
      </section>

      <p data-testid="announcement" className="text-sm text-stone-600">
        {t('home.announcement')}
      </p>

      <section aria-labelledby="categories-title">
        <h2 id="categories-title" className="font-serif text-xl font-semibold text-pine-900">
          {t('home.categoriesTitle')}
        </h2>
        <div className="mt-3">
          <CategoryShortcuts categories={categories} locale={locale} />
        </div>
      </section>

      <section aria-labelledby="selection-title">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="selection-title" className="font-serif text-xl font-semibold text-pine-900">
            {t('home.selectionTitle')}
          </h2>
          <Link
            href={`/${locale}/products`}
            className="shrink-0 text-sm text-pine-700 transition-colors hover:text-pine-800"
          >
            {t('search.allProducts')} →
          </Link>
        </div>
        <p className="mt-1 text-sm text-stone-500">{t('home.selectionSubtitle')}</p>
        <div className="mt-4">
          <ProductGrid products={products} locale={locale} t={t} />
        </div>
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-6 sm:p-8">
        <h2 className="font-serif text-xl font-semibold text-pine-900">{t('home.houseTitle')}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-stone-600">
          {t('home.houseBody')}
        </p>
      </section>
    </div>
  );
}
