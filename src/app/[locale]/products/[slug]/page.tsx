import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createT } from '@/i18n/catalog';
import { formatCny } from '@/i18n/format';
import { isLocaleId, type LocaleId } from '@/i18n/registry';
import { getProductBySlug } from '@/lib/products';
import { AddToCart } from '@/components/add-to-cart';
import { PlaceholderTea } from '@/components/placeholder-tea';
import { Seal } from '@/components/seal';

export const dynamic = 'force-dynamic';

interface ProductPageProps {
  params: Promise<{ locale: string; slug: string }>;
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { locale: raw, slug } = await params;
  if (!isLocaleId(raw)) notFound();
  const locale: LocaleId = raw;
  const t = createT(locale);

  const product = await getProductBySlug(slug, locale);
  if (!product) notFound();

  const inStock = product.inventory > 0;
  const glyph = product.name.trim().charAt(0) || '茶';

  return (
    <div className="flex flex-col gap-6 py-8">
      <nav aria-label="Breadcrumb" className="text-sm text-stone-500">
        <Link href={`/${locale}`} className="hover:text-pine-700">
          {t('nav.home')}
        </Link>
        {' / '}
        <Link href={`/${locale}/products`} className="hover:text-pine-700">
          {t('nav.products')}
        </Link>
        {' / '}
        <span className="text-stone-700">{product.name}</span>
      </nav>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div className="relative overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
          <PlaceholderTea slug={product.slug} className="aspect-square w-full" />
          <span className="absolute left-3 top-3 rounded-sm bg-white/90 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-stone-500 shadow-sm">
            {t('common.demoBadge')}
          </span>
        </div>

        <div className="flex flex-col gap-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="font-serif text-2xl font-semibold text-pine-900 sm:text-3xl" data-testid="product-name">
                {product.name}
              </h1>
              <p className="mt-1 text-sm text-stone-500">
                {product.category.name} · {product.sku}
              </p>
            </div>
            <Seal glyph={glyph} className="h-10 w-10 rounded-md rotate-6" />
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <span className="price-ticket text-base">{formatCny(product.priceCents, locale)}</span>
            <span
              data-testid="stock-status"
              className={`text-sm ${inStock ? 'text-pine-700' : 'text-lacquer-700'}`}
            >
              {inStock ? t('product.inStock') : t('product.outOfStock')}
            </span>
          </div>

          <dl className="grid grid-cols-1 gap-3 rounded-lg border border-stone-200 bg-stone-50 p-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wider text-stone-400">
                {t('product.originLabel')}
              </dt>
              <dd className="mt-0.5 text-stone-800">{product.origin}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-stone-400">
                {t('product.priceLabel')}
              </dt>
              <dd className="mt-0.5 text-stone-800">
                {formatCny(product.priceCents, locale)} / 100g
              </dd>
            </div>
          </dl>

          <div className="flex flex-wrap items-center gap-3">
            <AddToCart
              sku={product.sku}
              label={t('product.addToCart')}
              addedLabel={t('product.addedToCart')}
              disabled={!inStock}
            />
            <Link
              href={`/${locale}/products`}
              className="text-sm text-stone-500 underline decoration-stone-300 underline-offset-2 hover:text-pine-700"
            >
              {t('product.backToCatalog')}
            </Link>
          </div>
          <p className="text-xs text-stone-400">{t('product.cartDemoNote')}</p>

          <section className="flex flex-col gap-3 border-t border-stone-200 pt-5">
            <h2 className="font-serif text-lg font-semibold text-pine-900">
              {t('product.descriptionTitle')}
            </h2>
            <p className="text-sm leading-relaxed text-stone-600" data-testid="product-description">{product.description}</p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="font-serif text-lg font-semibold text-pine-900">
              {t('product.tastingNotesTitle')}
            </h2>
            <p className="text-sm leading-relaxed text-stone-600" data-testid="product-tasting-notes">{product.tastingNotes}</p>
          </section>
        </div>
      </div>
    </div>
  );
}
