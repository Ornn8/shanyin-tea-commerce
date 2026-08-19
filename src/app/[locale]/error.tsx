'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createT } from '@/i18n/catalog';
import { normalizeLocale } from '@/i18n/registry';

/**
 * Localized error boundary for the storefront (ADR-0006). Retry re-runs the
 * failing segment; the message and button are complete in all three locales.
 */
export default function StorefrontError({ reset }: { reset: () => void }) {
  const pathname = usePathname() ?? '';
  const locale = normalizeLocale(pathname.split('/')[1] ?? null);
  const t = createT(locale);
  return (
    <div className="flex flex-col items-center gap-4 py-24 text-center" data-testid="error-page">
      <p className="font-serif text-5xl font-semibold text-lacquer-300">!</p>
      <h1 className="font-serif text-xl font-semibold text-pine-900" data-testid="error-title">
        {t('error.title')}
      </h1>
      <p className="text-sm text-stone-500">{t('error.body')}</p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-md bg-pine-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-pine-800"
        >
          {t('error.retry')}
        </button>
        <Link
          href={`/${locale}`}
          className="rounded-md border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition-colors hover:border-pine-300 hover:text-pine-700"
        >
          {t('nav.home')}
        </Link>
      </div>
    </div>
  );
}