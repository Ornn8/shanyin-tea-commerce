import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createT } from '@/i18n/catalog';
import { isLocaleId, LOCALE_IDS, FALLBACK_LOCALE, type LocaleId } from '@/i18n/registry';
import { getProductDetail, getRelatedProducts } from '@/lib/products';
import { PRODUCT_SCHEMA_SCRIPT_ID, serializeProductSchema } from '@/lib/product-schema';
import { absoluteProductUrl, originFromHeaders } from '@/lib/site-url';
import { ProductPurchase } from '@/components/product-purchase';
import { ProductRecommendations } from '@/components/product-recommendations';
import { Seal } from '@/components/seal';

export const dynamic = 'force-dynamic';

export const RECOMMENDATION_LIMIT = 3;

interface ProductPageProps {
  params: Promise<{ locale: string; slug: string }>;
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { locale: raw, slug } = await params;
  if (!isLocaleId(raw)) return {};
  const locale: LocaleId = raw;
  const product = await getProductDetail(slug, locale);
  if (!product) return {};
  const t = createT(locale);
  const origin = originFromHeaders(await headers());
  const canonical = absoluteProductUrl(origin, locale, slug);
  const languages = Object.fromEntries(
    LOCALE_IDS.map((id) => [id, absoluteProductUrl(origin, id, slug)]),
  );
  return {
    title: product.seoTitle ?? `${product.name} · ${t('common.brandName')}`,
    description: product.seoDescription ?? product.description.slice(0, 160),
    alternates: {
      canonical,
      languages: { ...languages, 'x-default': absoluteProductUrl(origin, FALLBACK_LOCALE, slug) },
    },
  };
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { locale: raw, slug } = await params;
  if (!isLocaleId(raw)) notFound();
  const locale: LocaleId = raw;
  const t = createT(locale);

  const product = await getProductDetail(slug, locale);
  if (!product) notFound();

  const defaultVariant = product.variants[0];
  const recommended = await getRelatedProducts({ slug, locale, limit: RECOMMENDATION_LIMIT });
  const origin = originFromHeaders(await headers());
  const canonicalUrl = absoluteProductUrl(origin, locale, slug);
  // The structured data describes the default (first-created) variant; the
  // client picker patches the offers block on selection (ADR-0006).
  const jsonLd = serializeProductSchema({
    canonicalUrl,
    name: product.name,
    description: product.description,
    sku: defaultVariant?.sku ?? '',
    priceCents: defaultVariant?.priceCents ?? 0,
    inventory: defaultVariant?.inventory ?? 0,
    brandName: t('common.brandName'),
  });

  const glyph = product.name.trim().charAt(0) || '茶';
  // Stored localized alt text wins; otherwise the localized name-derived alt.
  const imageAlt = product.mediaAlt ?? t('product.mediaAlt', { name: product.name });

  return (
    <div data-product-id={product.id} className="flex flex-col gap-8 py-8">
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

      <div className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-semibold text-pine-900 sm:text-3xl" data-testid="product-name">
          {product.name}
        </h1>
        <p className="text-sm text-stone-500">
          {product.category.name} ·{' '}
          <span className="inline-flex items-center gap-1.5">
            <Seal glyph={glyph} className="h-6 w-6 rounded-md rotate-6" />
            {product.origin}
          </span>
        </p>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <ProductPurchase
          locale={locale}
          productSlug={product.slug}
          imageAlt={imageAlt}
          variants={product.variants}
          defaultSku={defaultVariant?.sku ?? ''}
          strings={{
            variantLegend: t('product.variantLabel'),
            skuLabel: t('product.skuLabel'),
            inStock: t('product.inStock'),
            lowStock: t('product.lowStock'),
            outOfStock: t('product.outOfStock'),
            unavailableOption: t('product.unavailableOption'),
            addToCart: t('product.addToCart'),
            addedToCart: t('product.addedToCart'),
            demoBadge: t('common.demoBadge'),
          }}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section aria-labelledby="facts-title" className="flex flex-col gap-3">
          <h2
            id="facts-title"
            className="font-serif text-lg font-semibold text-pine-900"
            data-testid="product-facts-title"
          >
            {t('product.factsTitle')}
          </h2>
          <dl className="grid grid-cols-1 gap-3 rounded-lg border border-stone-200 bg-stone-50 p-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wider text-stone-400">
                {t('product.originLabel')}
              </dt>
              <dd className="mt-0.5 text-stone-800">{product.origin}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-stone-400">
                {t('catalog.formLabel')}
              </dt>
              <dd className="mt-0.5 text-stone-800" data-testid="product-form">
                {t(`catalog.form.${product.form}`)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-stone-400">
                {t('catalog.caffeineLabel')}
              </dt>
              <dd className="mt-0.5 text-stone-800" data-testid="product-caffeine">
                {t(`catalog.caffeine.${product.caffeine}`)}
              </dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="description-title" className="flex flex-col gap-3">
          <h2
            id="description-title"
            className="font-serif text-lg font-semibold text-pine-900"
          >
            {t('product.descriptionTitle')}
          </h2>
          <p
            className="text-sm leading-relaxed text-stone-600"
            data-testid="product-description"
          >
            {product.description}
          </p>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section aria-labelledby="brewing-title" className="flex flex-col gap-3">
          <h2
            id="brewing-title"
            className="font-serif text-lg font-semibold text-pine-900"
          >
            {t('product.brewingTitle')}
          </h2>
          <p
            className="text-sm leading-relaxed text-stone-600"
            data-testid="product-brewing"
          >
            {product.brewingNotes || t('product.brewingEmpty')}
          </p>
        </section>

        <section aria-labelledby="tasting-title" className="flex flex-col gap-3">
          <h2
            id="tasting-title"
            className="font-serif text-lg font-semibold text-pine-900"
          >
            {t('product.tastingNotesTitle')}
          </h2>
          <p
            className="text-sm leading-relaxed text-stone-600"
            data-testid="product-tasting-notes"
          >
            {product.tastingNotes}
          </p>
        </section>
      </div>

      <aside
        aria-labelledby="warnings-title"
        className="rounded-lg border border-amber-200 bg-amber-50 p-4"
      >
        <h2
          id="warnings-title"
          className="text-sm font-semibold text-amber-900"
          data-testid="product-warnings-title"
        >
          {t('product.warningsTitle')}
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-amber-800" data-testid="product-demo-notice">
          {t('product.demoNotice')}
        </p>
        <p className="mt-1 text-xs text-amber-700/80">{t('product.cartDemoNote')}</p>
      </aside>

      <ProductRecommendations
        locale={locale}
        t={t}
        title={t('product.recommendationsTitle')}
        products={recommended}
      />

      <script
        id={PRODUCT_SCHEMA_SCRIPT_ID}
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd }}
      />
    </div>
  );
}