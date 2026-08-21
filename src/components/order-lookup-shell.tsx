'use client';

import { useActionState, useEffect } from 'react';
import { createT } from '@/i18n/catalog';
import type { LocaleId } from '@/i18n/registry';
import { lookupOrder, type LookupOrderResult } from '@/lib/checkout-actions';
import { readOrderTicket } from '@/lib/order-session';
import type { OrderView } from '@/lib/order-view';
import { OrderDetails } from '@/components/order-details';

interface OrderLookupShellProps {
  locale: LocaleId;
}

/** Local result type adds an explicit `empty` code for a blank submission. */
type LookupState =
  | (LookupOrderResult & { ok: true })
  | { ok: false; code: 'empty' | 'not-found' | 'unexpected' }
  | null;

/**
 * Order lookup shell (Issue #6, ADR-0008). Submits the credential to the
 * `lookupOrder` server action; found orders render immutably via
 * `OrderDetails`, and any wrong/missing input is the uniform localized "not
 * found". For convenience the credential the shopper already holds in
 * sessionStorage (just purchased in this tab) pre-fills the field.
 */
export function OrderLookupShell({ locale }: OrderLookupShellProps) {
  const t = createT(locale);

  const [state, formAction, pending] = useActionState<LookupState, FormData>(
    async (_prev, formData) => {
      const value =
        typeof formData.get('credential') === 'string'
          ? (formData.get('credential') as string).trim()
          : '';
      if (!value) return { ok: false, code: 'empty' };
      return lookupOrder(value, locale);
    },
    null,
  );

  // Pre-fill the credential the shopper just received in this tab (only);
  // a DOM-only side effect — no state synchronization needed.
  useEffect(() => {
    const credential = readOrderTicket()?.credential;
    if (!credential) return;
    const input = document.querySelector<HTMLInputElement>('[data-testid="orders-credential"]');
    if (input && !input.value) input.value = credential;
  }, []);

  const order: OrderView | null = state?.ok === true ? state.order : null;
  const errorCode = !state || state.ok ? null : state.code;

  return (
    <div className="flex flex-col gap-6 py-8">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-pine-900" data-testid="orders-title">
          {t('orders.title')}
        </h1>
        <p className="mt-1 text-sm text-stone-600">{t('orders.intro')}</p>
      </div>

      <form action={formAction} className="flex flex-col gap-3 rounded-lg border border-stone-200 bg-white p-5" data-testid="orders-lookup-form">
        <label htmlFor="orders-credential" className="block text-sm font-medium text-stone-700">
          {t('orders.credentialLabel')}
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="orders-credential"
            name="credential"
            data-testid="orders-credential"
            autoComplete="off"
            spellCheck={false}
            aria-describedby={errorCode ? 'orders-error' : undefined}
            className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 font-mono text-sm text-stone-900 placeholder:text-stone-400 focus:border-pine-600 focus:outline-none focus:ring-1 focus:ring-pine-600"
          />
          <button
            type="submit"
            disabled={pending}
            data-testid="orders-lookup-submit"
            className="inline-flex shrink-0 items-center justify-center rounded-md bg-pine-700 px-4 py-2 text-sm font-medium text-white hover:bg-pine-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('orders.lookupButton')}
          </button>
        </div>
        {errorCode && (
          <p id="orders-error" role="alert" data-testid="orders-error" className="text-xs text-lacquer-700">
            {t(
              errorCode === 'empty'
                ? 'orders.error.required'
                : errorCode === 'unexpected'
                  ? 'orders.unexpected'
                  : 'orders.notFound',
            )}
          </p>
        )}
      </form>

      {order && <OrderDetails locale={locale} order={order} />}
    </div>
  );
}
