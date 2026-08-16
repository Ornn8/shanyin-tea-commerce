import type { ReactNode } from 'react';
import type { LocaleId } from '@/i18n/registry';
import type { Translator } from '@/i18n/catalog';
import type { ProductView } from '@/lib/products';
import { ProductCard } from './product-card';

interface ProductGridProps {
  products: ProductView[];
  locale: LocaleId;
  t: Translator;
  empty?: ReactNode;
}

export function ProductGrid({ products, locale, t, empty }: ProductGridProps) {
  if (products.length === 0) {
    return <div className="py-10 text-center text-sm text-stone-500">{empty}</div>;
  }
  return (
    <div
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
      data-testid="product-grid"
    >
      {products.map((product) => (
        <ProductCard key={product.id} product={product} locale={locale} t={t} />
      ))}
    </div>
  );
}
