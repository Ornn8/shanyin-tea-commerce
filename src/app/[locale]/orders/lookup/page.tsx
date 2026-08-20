import { notFound } from 'next/navigation';
import { isLocaleId, type LocaleId } from '@/i18n/registry';
import { OrderLookupShell } from '@/components/order-lookup-shell';

export const dynamic = 'force-dynamic';

interface OrderLookupPageProps {
  params: Promise<{ locale: string }>;
}

/**
 * Secure order lookup (Issue #6, ADR-0008). This page is the ONLY public read
 * path: it renders a bare form and returns order data exclusively after a
 * matching high-entropy credential is submitted. A wrong, missing, or
 * malformed credential is the same uniform "not found" — order existence and
 * personal data are never enumerable through order numbers, emails, or URLs.
 */
export default async function OrderLookupPage({ params }: OrderLookupPageProps) {
  const { locale: raw } = await params;
  if (!isLocaleId(raw)) notFound();
  const locale: LocaleId = raw;
  return <OrderLookupShell locale={locale} />;
}
