import Link from 'next/link';
import type { LocaleId } from '@/i18n/registry';
import type { Translator } from '@/i18n/catalog';
import { formatCny } from '@/i18n/format';
import type { ProductView } from '@/lib/products';
import { PlaceholderTea } from './placeholder-tea';
import { SealSm } from './seal';

interface ProductCardProps {
  product: ProductView;
  locale: LocaleId;
  t: Translator;
}

export function ProductCard({ product, locale, t }: ProductCardProps) {
  const glyph = product.name.trim().charAt(0) || '茶';
  return (
    <Link
      href={`/${locale}/products/${product.slug}`}
      className="ticket-card group flex flex-col overflow-hidden transition-transform hover:-translate-y-0.5"
      data-testid="product-card"
    >
      <div className="relative">
        <PlaceholderTea slug={product.slug} className="aspect-[4/3] w-full" />
        <span className="absolute left-2 top-2 rounded-sm bg-white/90 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-stone-500 shadow-sm">
          {t('common.demoBadge')}
        </span>
        {product.inventory === 0 && (
          <span
            data-testid="stock-badge"
            className="absolute bottom-2 left-2 rounded-sm bg-lacquer-600 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white shadow-sm"
          >
            {t('product.outOfStock')}
          </span>
        )}
        <span className="absolute right-2 top-2">
          <SealSm glyph={glyph} className="rotate-6" />
        </span>
      </div>
      <div className="ticket-perforation" aria-hidden="true" />
      <div className="flex flex-1 flex-col gap-1 p-4">
        <h3 className="font-serif text-base font-semibold text-pine-900 transition-colors group-hover:text-pine-700">
          {product.name}
        </h3>
        <p className="text-xs text-stone-500">{product.origin}</p>
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <span className="price-ticket">{formatCny(product.priceCents, locale)}</span>
          <span className="text-xs text-stone-400">{product.category.name}</span>
        </div>
      </div>
    </Link>
  );
}
