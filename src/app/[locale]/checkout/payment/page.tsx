import { notFound } from 'next/navigation';
import { isLocaleId, type LocaleId } from '@/i18n/registry';
import { PaymentShell } from '@/components/payment-shell';

export const dynamic = 'force-dynamic';

interface PaymentPageProps {
  params: Promise<{ locale: string }>;
}

/**
 * Payment step (Issue #6, ADR-0008). The client shell reads the checkout
 * ticket from sessionStorage and calls the `completePayment` server action,
 * which drives the deterministic simulated gateway and processes its SIGNED
 * event through the replay-safe pipeline. A browser redirect is never payment
 * authority: the confirmation page only renders after the verified event, and
 * every step re-validates by credential against the database.
 */
export default async function PaymentPage({ params }: PaymentPageProps) {
  const { locale: raw } = await params;
  if (!isLocaleId(raw)) notFound();
  const locale: LocaleId = raw;
  return <PaymentShell locale={locale} />;
}
