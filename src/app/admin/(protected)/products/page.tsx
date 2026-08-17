import Link from 'next/link';
import { formatCny } from '@/i18n/format';
import { LOCALE_IDS, LOCALE_META } from '@/i18n/registry';
import { listAdminProducts } from '@/lib/admin/products';

/**
 * Product list for the merchant: shared facts, variant price/inventory
 * ranges, publication state, and per-locale name coverage in one place.
 */
export default async function AdminProductsPage() {
  const products = await listAdminProducts();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-pine-900">Products</h1>
          <p className="mt-1 text-sm text-stone-500" data-testid="admin-product-count">
            {products.length} product{products.length === 1 ? '' : 's'} — shared facts, variants,
            prices, inventory, and publication state.
          </p>
        </div>
        <Link
          href="/admin/products/new"
          className="rounded-md bg-pine-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-pine-800"
          data-testid="new-product-link"
        >
          New product
        </Link>
      </div>

      {products.length === 0 ? (
        <p className="rounded-md border border-stone-200 bg-white p-6 text-sm text-stone-500">
          No products yet. Create the first one.
        </p>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="admin-product-list">
          {products.map((product) => {
            const prices = product.variants.map((variant) => variant.priceCents);
            const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
            const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;
            const totalInventory = product.variants.reduce((sum, variant) => sum + variant.inventory, 0);
            return (
              <li key={product.id}>
                <Link
                  href={`/admin/products/${product.id}`}
                  className="block rounded-lg border border-stone-200 bg-white p-4 transition-colors hover:border-pine-300 hover:shadow-sm"
                  data-testid="admin-product-row"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-stone-900">{product.slug}</span>
                        {product.published ? (
                          <span className="rounded-full bg-pine-100 px-2 py-0.5 text-xs font-medium text-pine-800" data-testid="published-badge">
                            Published
                          </span>
                        ) : (
                          <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600" data-testid="unpublished-badge">
                            Draft
                          </span>
                        )}
                        <span className="text-xs text-stone-400">{product.categorySlug}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-stone-600">
                        <span>
                          {prices.length === 1
                            ? formatCny(prices[0], 'en')
                            : `${formatCny(minPrice, 'en')} – ${formatCny(maxPrice, 'en')}`}
                        </span>
                        <span data-testid="inventory-total">
                          Inventory: {totalInventory}
                        </span>
                        <span className="text-stone-400">
                          {product.variants.length} variant{product.variants.length === 1 ? '' : 's'} ·{' '}
                          {product.variants.map((variant) => variant.sku).join(', ')}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2" data-testid="locale-coverage">
                      {LOCALE_IDS.map((locale) => {
                        const localization = product.localizations.find((loc) => loc.locale === locale);
                        const hasName = Boolean(localization?.name.trim());
                        return (
                          <span
                            key={locale}
                            title={`${LOCALE_META[locale].label}: ${hasName ? 'title present' : 'title missing (English fallback)'}`}
                            className={hasName ? 'text-pine-700' : 'text-stone-300'}
                          >
                            {locale}
                            {hasName ? ' ✓' : ' —'}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
