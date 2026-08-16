import Link from 'next/link';
import type { LocaleId } from '@/i18n/registry';
import type { CategoryView } from '@/lib/products';

interface CategoryShortcutsProps {
  categories: CategoryView[];
  locale: LocaleId;
}

export function CategoryShortcuts({ categories, locale }: CategoryShortcutsProps) {
  return (
    <div className="flex flex-wrap gap-2" data-testid="category-shortcuts">
      {categories.map((category) => (
        <Link
          key={category.slug}
          href={`/${locale}/products?category=${category.slug}`}
          className="inline-flex items-center gap-1.5 rounded-full border border-celadon-300 bg-celadon-50 px-3.5 py-1.5 text-sm text-pine-800 transition-colors hover:border-pine-400 hover:bg-celadon-100"
        >
          {category.name}
          <span className="text-xs text-stone-500">· {category.productCount}</span>
        </Link>
      ))}
    </div>
  );
}
