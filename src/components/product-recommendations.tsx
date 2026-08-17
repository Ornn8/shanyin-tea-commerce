import type { Translator } from '@/i18n/catalog';
import type { LocaleId } from '@/i18n/registry';
import { ProductCard } from './product-card';

interface ProductRecommendationsProps {
  locale: LocaleId;
  t: Translator;
  title: string;
  products: Parameters<typeof ProductCard>[0]['product'][];
}

/**
 * Recommendations section of the product detail page (ADR-0006).
 *
 * `products` are resolved server-side by getRelatedProducts: published
 * products only, same category first, never the current product, each product
 * once — product facts are language-neutral, so there is no per-locale
 * duplication. The grid reuses the same ticket-card links as the catalog.
 */
export function ProductRecommendations({
  locale,
  t,
  title,
  products,
}: ProductRecommendationsProps) {
  if (products.length === 0) return null;
  return (
    <section
      aria-labelledby="recommendations-title"
      className="flex flex-col gap-4 border-t border-stone-200 pt-6"
    >
      <h2
        id="recommendations-title"
        className="font-serif text-lg font-semibold text-pine-900"
        data-testid="recommendations-title"
      >
        {title}
      </h2>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3" data-testid="recommendations">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} locale={locale} t={t} />
        ))}
      </div>
    </section>
  );
}