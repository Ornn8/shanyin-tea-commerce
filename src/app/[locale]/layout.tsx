import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { createT } from '@/i18n/catalog';
import { isLocaleId, LOCALE_IDS, LOCALE_META, type LocaleId } from '@/i18n/registry';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import '../globals.css';

export function generateStaticParams() {
  return LOCALE_IDS.map((locale) => ({ locale }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: raw } = await params;
  if (!isLocaleId(raw)) return { title: 'Shanyin Tea' };
  const t = createT(raw);
  return {
    title: `${t('common.brandName')} · ${t('common.brandNameZh')}`,
    description: t('home.heroSubtitle'),
  };
}

interface LocaleLayoutProps {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { locale: raw } = await params;
  if (!isLocaleId(raw)) notFound();
  const locale: LocaleId = raw;
  const t = createT(locale);

  return (
    <html lang={LOCALE_META[locale].htmlLang}>
      <body className="flex min-h-screen flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-pine-800 focus:px-4 focus:py-2 focus:text-sm focus:text-white"
        >
          {t('common.skipToContent')}
        </a>
        <SiteHeader locale={locale} t={t} />
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 sm:px-6">
          {children}
        </main>
        <SiteFooter t={t} />
      </body>
    </html>
  );
}
