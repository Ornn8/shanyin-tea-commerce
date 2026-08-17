/**
 * Catalog pagination — every page transition is a plain link whose href keeps
 * the full discovery state (query + filters + sort), so pagination survives
 * refresh and back/forward navigation (ADR-0004).
 */
import Link from 'next/link';
import type { Translator } from '@/i18n/catalog';
import type { LocaleId } from '@/i18n/registry';
import { buildCatalogUrl, type CatalogBase, type CatalogParams } from '@/lib/catalog-params';
import type { CatalogResult } from '@/lib/products';

const LINK_CLASS =
  'inline-flex items-center rounded-md border border-stone-200 bg-white px-3 py-1.5 text-sm text-pine-800 shadow-sm transition-colors hover:border-pine-400 hover:bg-celadon-50';
const DISABLED_CLASS =
  'inline-flex items-center rounded-md border border-stone-100 bg-stone-50 px-3 py-1.5 text-sm text-stone-400';
const CURRENT_CLASS =
  'inline-flex items-center rounded-md bg-pine-700 px-3 py-1.5 text-sm font-medium text-white shadow-sm';

/** Window of page numbers with ellipsis gaps for large page counts. */
function pageWindow(page: number, pageCount: number): (number | '…')[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1);
  const wanted = new Set([1, pageCount, page - 1, page, page + 1]);
  const sorted = [...wanted].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  let previous = 0;
  for (const p of sorted) {
    if (previous !== 0 && p - previous > 1) out.push('…');
    out.push(p);
    previous = p;
  }
  return out;
}

interface CatalogPaginationProps {
  locale: LocaleId;
  t: Translator;
  base: CatalogBase;
  params: CatalogParams;
  result: CatalogResult;
}

export function CatalogPagination({ locale, t, base, params, result }: CatalogPaginationProps) {
  const { page, pageCount } = result;
  if (pageCount <= 1) return null;

  const hrefFor = (target: number) => buildCatalogUrl(locale, base, { ...params, page: target });

  return (
    <nav
      aria-label="Pagination"
      data-testid="catalog-pagination"
      className="flex flex-wrap items-center justify-center gap-2 py-2"
    >
      <p className="sr-only">
        {t('catalog.pageOf', { page: String(page), pages: String(pageCount) })}
      </p>

      {page > 1 ? (
        <Link href={hrefFor(page - 1)} className={LINK_CLASS} data-testid="prev-page">
          ← {t('catalog.prevPage')}
        </Link>
      ) : (
        <span className={DISABLED_CLASS} aria-disabled="true">
          ← {t('catalog.prevPage')}
        </span>
      )}

      {pageWindow(page, pageCount).map((entry, index) =>
        entry === '…' ? (
          <span key={`gap-${index}`} className="px-1 text-sm text-stone-400" aria-hidden="true">
            …
          </span>
        ) : entry === page ? (
          <span key={entry} className={CURRENT_CLASS} aria-current="page" data-testid="current-page">
            {entry}
          </span>
        ) : (
          <Link key={entry} href={hrefFor(entry)} className={LINK_CLASS} data-testid={`page-${entry}`}>
            {entry}
          </Link>
        ),
      )}

      {page < pageCount ? (
        <Link href={hrefFor(page + 1)} className={LINK_CLASS} data-testid="next-page">
          {t('catalog.nextPage')} →
        </Link>
      ) : (
        <span className={DISABLED_CLASS} aria-disabled="true">
          {t('catalog.nextPage')} →
        </span>
      )}
    </nav>
  );
}
