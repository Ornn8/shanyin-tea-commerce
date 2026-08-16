import { cookies } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createT } from '@/i18n/catalog';
import { formatCny } from '@/i18n/format';
import { isLocaleId, type LocaleId } from '@/i18n/registry';
import { CART_COOKIE, parseCart } from '@/lib/cart';
import { getProductsBySkus } from '@/lib/products';
import { RemoveFromCart } from '@/components/remove-from-cart';

export const dynamic = 'force-dynamic';

interface CartPageProps {
  params: Promise<{ locale: string }>;
}

export default async function CartPage({ params }: CartPageProps) {
  const { locale: raw } = await params;
  if (!isLocaleId(raw)) notFound();
  const locale: LocaleId = raw;
  const t = createT(locale);

  const cookieStore = await cookies();
  // Next.js already percent-decodes cookie values, so the JSON array is
  // parsed directly (parseCart tolerates raw or already-decoded input).
  const skus = parseCart(cookieStore.get(CART_COOKIE)?.value);
  const items = await getProductsBySkus(skus, locale);
  const totalCents = items.reduce((sum, item) => sum + item.priceCents, 0);

  return (
    <div className="flex flex-col gap-6 py-8">
      <h1 className="font-serif text-2xl font-semibold text-pine-900" data-testid="cart-title">
        {t('cart.title')}
      </h1>
      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-stone-300 bg-white p-10 text-center">
          <p className="text-sm text-stone-500">{t('cart.empty')}</p>
          <Link
            href={`/${locale}/products`}
            className="mt-4 inline-flex rounded-md bg-pine-700 px-4 py-2 text-sm font-medium text-white hover:bg-pine-800"
          >
            {t('home.heroCta')}
          </Link>
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-3" data-testid="cart-items">
            {items.map((item) => (
              <li
                key={item.sku}
                className="flex items-center justify-between gap-4 rounded-lg border border-stone-200 bg-white p-4"
              >
                <div className="min-w-0">
                  <Link
                    href={`/${locale}/products/${item.slug}`}
                    className="font-serif text-base font-semibold text-pine-900 hover:text-pine-700"
                  >
                    {item.name}
                  </Link>
                  <p className="mt-0.5 text-xs text-stone-500">
                    {item.sku} · {item.origin}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-sm font-medium text-stone-800">
                    {formatCny(item.priceCents, locale)}
                  </span>
                  <RemoveFromCart sku={item.sku} label={t('cart.remove')} />
                </div>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between rounded-lg border border-stone-200 bg-white p-4">
            <span className="text-sm text-stone-600">{t('product.priceLabel')}</span>
            <span className="price-ticket text-base" data-testid="cart-total">
              {formatCny(totalCents, locale)}
            </span>
          </div>
          <p className="text-xs text-stone-400">{t('product.cartDemoNote')}</p>
        </>
      )}
    </div>
  );
}
