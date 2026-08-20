import { notFound } from 'next/navigation';
import { isLocaleId, type LocaleId } from '@/i18n/registry';
import { ConfirmationShell } from '@/components/confirmation-shell';

export const dynamic = 'force-dynamic';

interface ConfirmationPageProps {
  params: Promise<{ locale: string }>;
}

/**
 * Order confirmation (Issue #6, ADR-0008). The shell re-validates by the
 * credential held in sessionStorage on every render/refresh — never trusting
 * the last navigation — and shows the order ONLY when the stored order is
 * `paid` (state driven by a verified gateway event, not by this page existing).
 * The high-entropy lookup credential is shown so the shopper can save it; a
 * replayed/re-entered submission recovers the SAME credential (ADR-0008).
 */
export default async function ConfirmationPage({ params }: ConfirmationPageProps) {
  const { locale: raw } = await params;
  if (!isLocaleId(raw)) notFound();
  const locale: LocaleId = raw;
  return <ConfirmationShell locale={locale} />;
}
