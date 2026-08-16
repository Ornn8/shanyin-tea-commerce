import type { Translator } from '@/i18n/catalog';

interface SiteFooterProps {
  t: Translator;
}

export function SiteFooter({ t }: SiteFooterProps) {
  return (
    <footer className="mt-16 border-t border-stone-200 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-4 text-sm text-stone-600">
          <p className="max-w-3xl text-xs leading-relaxed text-stone-500">{t('footer.disclaimer')}</p>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-4">
            <p className="text-xs text-stone-400">{t('footer.copyrightText')}</p>
            <a
              href="https://github.com/Ornn8/shanyin-tea-commerce/blob/main/PRODUCT.md"
              className="text-xs text-pine-700 underline decoration-pine-200 underline-offset-2 hover:text-pine-800"
              target="_blank"
              rel="noreferrer"
            >
              {t('footer.merchantFacts')}
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
