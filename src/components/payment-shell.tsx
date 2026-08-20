'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { createT } from '@/i18n/catalog';
import type { LocaleId } from '@/i18n/registry';
import { completePayment, type CompletePaymentResult } from '@/lib/checkout-actions';
import { readOrderTicket, writeOrderTicket } from '@/lib/order-session';
import type { OrderView } from '@/lib/order-view';

interface PaymentShellProps {
  locale: LocaleId;
}

type Phase =
  | { kind: 'processing' }
  | { kind: 'no-order' }
  | { kind: 'failed'; order?: OrderView }
  | { kind: 'unexpected' };

/**
 * Payment step shell (Issue #6, ADR-0008). Reads the credential from
 * sessionStorage (never the URL), drives the deterministic simulated gateway
 * via the `completePayment` server action, and advances to the confirmation
 * page only after the verified `succeeded` event has been applied. A failure
 * (including a payment-time stock shortage) returns the shopper to the cart —
 * which is kept until payment actually succeeds — for retry.
 */
export function PaymentShell({ locale }: PaymentShellProps) {
  const t = createT(locale);
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: 'processing' });
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    (async () => {
      const ticket = readOrderTicket();
      if (!ticket) {
        setPhase({ kind: 'no-order' });
        return;
      }
      try {
        const result: CompletePaymentResult = await completePayment(ticket.credential, locale);
        if (!result.ok) {
          setPhase({ kind: 'unexpected' });
          return;
        }
        if (result.status === 'PAID') {
          // Keep the ticket (confirmation re-validates by credential) and
          // advance. The cart cookie was cleared server-side on success.
          writeOrderTicket({
            credential: result.credential,
            checkoutId: result.order.orderId,
            orderNumber: result.order.orderNumber,
          });
          window.dispatchEvent(new Event('shanyin:cart'));
          // replace(), not push(): Back from confirmation must not re-run the
          // (idempotent) payment step.
          router.replace(`/${locale}/checkout/confirmation`);
          return;
        }
        setPhase({ kind: 'failed', order: result.order });
      } catch {
        setPhase({ kind: 'unexpected' });
      }
    })();
  }, [locale, router]);

  if (phase.kind === 'processing') {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center" data-testid="payment-processing">
        <h1 className="font-serif text-2xl font-semibold text-pine-900">{t('payment.title')}</h1>
        <p className="text-sm text-stone-600">{t('payment.processing')}</p>
        <div
          aria-hidden="true"
          className="h-8 w-8 animate-spin rounded-full border-2 border-pine-200 border-t-pine-700"
        />
        <p className="max-w-md text-xs text-stone-400" data-testid="payment-processing-note">
          {t('payment.processingNote')}
        </p>
      </div>
    );
  }

  if (phase.kind === 'failed') {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 py-16 text-center" data-testid="payment-failed">
        <h1 className="font-serif text-2xl font-semibold text-pine-900">{t('payment.failedTitle')}</h1>
        <p className="text-sm text-stone-600">{t('payment.failedBody')}</p>
        <Link
          href={`/${locale}/cart`}
          data-testid="payment-retry"
          className="inline-flex rounded-md bg-pine-700 px-4 py-2 text-sm font-medium text-white hover:bg-pine-800"
        >
          {t('payment.retryCart')}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 py-16 text-center" data-testid="payment-no-order">
      <h1 className="font-serif text-2xl font-semibold text-pine-900">
        {phase.kind === 'unexpected' ? t('payment.failedTitle') : t('payment.noOrderTitle')}
      </h1>
      <p className="text-sm text-stone-600">
        {phase.kind === 'unexpected' ? t('payment.failedBody') : t('payment.noOrderBody')}
      </p>
      <Link
        href={`/${locale}/products`}
        className="inline-flex rounded-md bg-pine-700 px-4 py-2 text-sm font-medium text-white hover:bg-pine-800"
      >
        {t('payment.browse')}
      </Link>
    </div>
  );
}
