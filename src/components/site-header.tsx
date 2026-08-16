import Link from 'next/link';
import { LOCALE_IDS, LOCALE_META, type LocaleId } from '@/i18n/registry';
import type { Translator } from '@/i18n/catalog';
import { LocalePicker } from './locale-picker';
import { CartButton } from './cart-button';
import { Seal } from './seal';

interface SearchBarProps {
  action: string;
  placeholder: string;
  buttonLabel: string;
}

function SearchBar({ action, placeholder, buttonLabel }: SearchBarProps) {
  return (
    <form action={action} method="GET" role="search" className="flex w-full max-w-xl gap-2">
      <input
        type="search"
        name="q"
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-w-0 flex-1 rounded-md border border-stone-200 bg-white px-3 py-1.5 text-sm text-stone-800 shadow-sm placeholder:text-stone-400 focus:border-pine-500 focus:outline-none focus:ring-2 focus:ring-pine-200"
      />
      <button
        type="submit"
        className="shrink-0 rounded-md bg-pine-700 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-pine-800"
      >
        {buttonLabel}
      </button>
    </form>
  );
}

interface SiteHeaderProps {
  locale: LocaleId;
  t: Translator;
}

/**
 * Two-level header: brand + utilities on top, search + navigation below.
 * Locale options come from the registry.
 */
export function SiteHeader({ locale, t }: SiteHeaderProps) {
  const options = LOCALE_IDS.map((id) => ({ id, label: LOCALE_META[id].label }));
  return (
    <header className="sticky top-0 z-40 border-b border-stone-200 bg-white/95 backdrop-blur">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex items-center justify-between gap-3 py-3">
          <Link href={`/${locale}`} className="group flex items-center gap-2.5">
            <Seal glyph="山" className="h-9 w-9 rounded-md" label="Shanyin" />
            <span className="flex flex-col leading-tight">
              <span className="font-serif text-lg font-semibold tracking-wide text-pine-900">
                {t('common.brandName')}
              </span>
              <span className="text-xs tracking-[0.2em] text-stone-500">{t('common.brandNameZh')}</span>
            </span>
          </Link>
          <div className="flex items-center gap-2.5">
            <LocalePicker locale={locale} options={options} label={t('locale.switchTo')} />
            <CartButton href={`/${locale}/cart`} label={t('nav.cart')} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-stone-100 py-2.5">
          <nav aria-label="Main" className="flex items-center gap-5 text-sm">
            <Link href={`/${locale}`} className="text-stone-700 transition-colors hover:text-pine-700">
              {t('nav.home')}
            </Link>
            <Link href={`/${locale}/products`} className="text-stone-700 transition-colors hover:text-pine-700">
              {t('nav.products')}
            </Link>
          </nav>
          <div className="ml-auto w-full sm:w-auto">
            <SearchBar
              action={`/${locale}/search`}
              placeholder={t('home.searchPlaceholder')}
              buttonLabel={t('home.searchButton')}
            />
          </div>
        </div>
      </div>
    </header>
  );
}
