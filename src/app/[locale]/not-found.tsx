'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createT } from '@/i18n/catalog';
import { normalizeLocale } from '@/i18n/registry';

/**
 * Localized 404 for the storefront (ADR-0006). The locale is derived from
 * the pathname so the empty state is complete in zh-CN / en / ja — with the
 * same i18n keys used across every product-facing surface.
 */
export default function NotFound() {
  const pathname = usePathname() ?? '';
  const locale = normalizeLocale(pathname.split('/')[1] ?? null);
  const t = createT(locale);
  return (
    <div className="flex flex-col items-center gap-4 py-24 text-center" data-testid="not-found">
      <p className="font-serif text-5xl font-semibold text-pine-200">404</p>
      <h1 className="font-serif text-xl font-semibold text-pine-900" data-testid="not-found-title">
        {t('product.notFoundTitle')}
      </h1>
      <p className="text-sm text-stone-500">{t('product.notFoundBody')}</p>
      <Link
        href={`/${locale}`}
        className="rounded-md bg-pine-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-pine-800"
      >
        {t('nav.home')}
      </Link>
    </div>
  );
}