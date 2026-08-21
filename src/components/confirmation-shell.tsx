'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { createT } from '@/i18n/catalog';
import type { LocaleId } from '@/i18n/registry';
import { getCheckoutConfirmation, type ConfirmationResult } from '@/lib/checkout-actions';
import { readOrderTicket, writeOrderTicket } from '@/lib/order-session';
import type { OrderView } from '@/lib/order-view';
import { OrderDetails } from '@/components/order-details';

interface ConfirmationShellProps {
  locale: LocaleId;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'paid'; order: OrderView; credential: string }
  | { kind: 'pending' }
  | { kind: 'not-paid' }
  | { kind: 'no-recent' };

/**
 * Confirmation shell (Issue #6, ADR-0008). Re-validates by credential every
 * render; a refreshed page stays correct without trusting navigation or the
 * URL. Renders the paid order with its high-entropy lookup credential (the
 * SAME credential is recoverable on a replayed submission, ADR-0008), or the
 * matching localized state for pending / non-paid / no-recent.
 */
export function ConfirmationShell({ locale }: ConfirmationShellProps) {
  const t = createT(locale);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [copied, setCopied] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    (async () => {
      const ticket = readOrderTicket();
      if (!ticket) {
        setPhase({ kind: 'no-recent' });
        return;
      }
      try {
        const result: ConfirmationResult = await getCheckoutConfirmation(ticket.credential, locale);
        if (!result.ok) {
          setPhase({ kind: 'no-recent' });
          return;
        }
        // Keep the ticket refreshed (order id, credential) for the lookup page.
        writeOrderTicket({
          credential: result.credential,
          checkoutId: result.order.orderId,
          orderNumber: result.order.orderNumber,
        });
        if (result.order.status === 'PAID') {
          setPhase({ kind: 'paid', order: result.order, credential: result.credential });
        } else if (result.order.status === 'PENDING') {
          setPhase({ kind: 'pending' });
        } else {
          setPhase({ kind: 'not-paid' });
        }
      } catch {
        setPhase({ kind: 'no-recent' });
      }
    })();
  }, [locale]);

  async function copyCredential() {
    if (phase.kind !== 'paid') return;
    try {
      await navigator.clipboard.writeText(phase.credential);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be unavailable (e.g. permissions); the credential stays
      // selectable inline as a fallback.
    }
  }

  if (phase.kind === 'loading') {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-stone-500" data-testid="confirmation-loading">
          {t('payment.processing')}
        </p>
      </div>
    );
  }

  if (phase.kind === 'paid') {
    const { order, credential } = phase;
    return (
      <div className="flex flex-col gap-6 py-8" data-testid="confirmation-paid">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-pine-900" data-testid="confirmation-title">
            {t('confirmation.title')}
          </h1>
          <p className="mt-1 text-sm text-stone-600" data-testid="confirmation-thanks">
            {t('confirmation.thanks')}
          </p>
        </div>

        <div className="rounded-lg border border-pine-200 bg-pine-50 p-4" data-testid="confirmation-credential">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-pine-800">
            {t('confirmation.credentialTitle')}
          </h2>
          <p className="mt-1 text-xs text-pine-900/70">{t('confirmation.credentialBody')}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code
              data-testid="confirmation-credential-value"
              className="rounded-md bg-white px-2.5 py-1.5 text-xs text-pine-900 [overflow-wrap:anywhere]"
            >
              {credential}
            </code>
            <button
              type="button"
              onClick={copyCredential}
              data-testid="confirmation-copy"
              className="rounded-md border border-pine-300 bg-white px-2.5 py-1.5 text-xs font-medium text-pine-800 hover:bg-pine-100"
            >
              {copied ? t('confirmation.copied') : t('confirmation.copy')}
            </button>
          </div>
        </div>

        <OrderDetails locale={locale} order={order} />

        <Link
          href={`/${locale}/orders/lookup`}
          data-testid="confirmation-view-order"
          className="inline-flex w-fit rounded-md bg-pine-700 px-4 py-2 text-sm font-medium text-white hover:bg-pine-800"
        >
          {t('confirmation.viewOrder')}
        </Link>
      </div>
    );
  }

  if (phase.kind === 'pending') {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 py-16 text-center" data-testid="confirmation-pending">
        <h1 className="font-serif text-2xl font-semibold text-pine-900">{t('confirmation.pendingTitle')}</h1>
        <p className="text-sm text-stone-600">{t('confirmation.pendingBody')}</p>
      </div>
    );
  }

  if (phase.kind === 'not-paid') {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 py-16 text-center" data-testid="confirmation-not-paid">
        <h1 className="font-serif text-2xl font-semibold text-pine-900">{t('confirmation.notPaidTitle')}</h1>
        <p className="text-sm text-stone-600">{t('confirmation.notPaidBody')}</p>
        <Link
          href={`/${locale}/cart`}
          className="inline-flex rounded-md bg-pine-700 px-4 py-2 text-sm font-medium text-white hover:bg-pine-800"
        >
          {t('payment.retryCart')}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 py-16 text-center" data-testid="confirmation-no-recent">
      <h1 className="font-serif text-2xl font-semibold text-pine-900">{t('confirmation.noRecentTitle')}</h1>
      <p className="text-sm text-stone-600">{t('confirmation.noRecentBody')}</p>
      <Link
        href={`/${locale}/orders/lookup`}
        className="inline-flex rounded-md bg-pine-700 px-4 py-2 text-sm font-medium text-white hover:bg-pine-800"
      >
        {t('confirmation.lookupLink')}
      </Link>
    </div>
  );
}
