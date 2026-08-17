import Link from 'next/link';
import type { LocaleId } from '@/i18n/registry';
import { buildCatalogUrl, type CatalogParams } from '@/lib/catalog-params';
import type { CategoryView } from '@/lib/products';

interface CategoryShortcutsProps {
  categories: CategoryView[];
  locale: LocaleId;
  /** Current catalog params to preserve when jumping to a category (optional). */
  params?: CatalogParams;
}

export function CategoryShortcuts({ categories, locale, params }: CategoryShortcutsProps) {
  return (
    <div className="flex flex-wrap gap-2" data-testid="category-shortcuts">
      {categories.map((category) => (
        <Link
          key={category.slug}
          href={buildCatalogUrl(locale, 'products', { ...params, category: category.slug, page: 1 })}
          className="inline-flex items-center gap-1.5 rounded-full border border-celadon-300 bg-celadon-50 px-3.5 py-1.5 text-sm text-pine-800 transition-colors hover:border-pine-400 hover:bg-celadon-100"
        >
          {category.name}
          <span className="text-xs text-stone-500">· {category.productCount}</span>
        </Link>
      ))}
    </div>
  );
}
