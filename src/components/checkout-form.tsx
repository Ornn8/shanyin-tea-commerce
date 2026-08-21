'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';
import { createT } from '@/i18n/catalog';
import { formatCny } from '@/i18n/format';
import type { LocaleId } from '@/i18n/registry';
import type { MessageKey } from '@/i18n/messages/en';
import {
  createCheckout,
  type CreateCheckoutResult,
} from '@/lib/checkout-actions';
import type { CheckoutField } from '@/lib/checkout-validation';
import {
  generateCheckoutSubmissionKey,
  readCheckoutSubmissionRef,
  readOrderTicket,
  writeCheckoutSubmissionRef,
  writeOrderTicket,
} from '@/lib/order-session';

export interface CheckoutFormLine {
  sku: string;
  /** Localized product-name snapshot for the active locale. */
  name: string;
  variantName: string;
  quantity: number;
  priceCents: number;
  subtotalCents: number;
}

interface CheckoutFormProps {
  locale: LocaleId;
  lines: CheckoutFormLine[];
  subtotalCents: number;
  shippingFeeCents: number;
  totalCents: number;
  /** Fingerprint of the signed cart cookie this form belongs to — the
   * submission idempotency key is bound to it so a new cart rotates to a fresh
   * key and can never collide with an older order. */
  cartFingerprint: string;
}

const FIELDS: Array<{ id: CheckoutField; name: string; labelKey: MessageKey; testId: string; type?: string; autoComplete: string }> = [
  { id: 'email', name: 'email', labelKey: 'checkout.emailLabel', testId: 'checkout-email', type: 'email', autoComplete: 'email' },
  { id: 'recipientName', name: 'recipientName', labelKey: 'checkout.recipientNameLabel', testId: 'checkout-recipientName', autoComplete: 'name' },
  { id: 'addressLine1', name: 'addressLine1', labelKey: 'checkout.addressLine1Label', testId: 'checkout-addressLine1', autoComplete: 'address-line1' },
  { id: 'city', name: 'city', labelKey: 'checkout.cityLabel', testId: 'checkout-city', autoComplete: 'address-level2' },
  { id: 'region', name: 'region', labelKey: 'checkout.regionLabel', testId: 'checkout-region', autoComplete: 'address-level1' },
  { id: 'postalCode', name: 'postalCode', labelKey: 'checkout.postalCodeLabel', testId: 'checkout-postalCode', autoComplete: 'postal-code' },
  { id: 'countryCode', name: 'countryCode', labelKey: 'checkout.countryCodeLabel', testId: 'checkout-countryCode', autoComplete: 'country' },
];

/**
 * Checkout form (Issue #6, ADR-0008). Collects ONLY the minimum documented
 * contact + shipping fields; the server re-validates every field and owns all
 * totals. On success the high-entropy lookup credential is parked in
 * sessionStorage (never the URL) and the flow advances to the payment step.
 *
 * Idempotent by client submission key: the key is generated once per checkout
 * (bound to this cart's fingerprint and persisted in sessionStorage, so a
 * double-click, a browser retry, or a refresh before paying reuses it). The
 * server returns the EXISTING order for a replayed key together with the SAME
 * derived credential, so even a lost first response never leaves the flow
 * without a credential that payment needs.
 */
export function CheckoutForm({ locale, lines, subtotalCents, shippingFeeCents, totalCents, cartFingerprint }: CheckoutFormProps) {
  const t = createT(locale);
  const router = useRouter();

  // High-entropy submission idempotency key, generated once per cart and
  // pinned in sessionStorage. Reused across retries/refreshes for the SAME
  // cart; rotated when the cart changes so an old key never collides with a
  // previously created order.
  const [submissionKey] = useState(() => {
    const stored = readCheckoutSubmissionRef();
    if (stored && stored.key && stored.cartFingerprint === cartFingerprint) return stored.key;
    const fresh = generateCheckoutSubmissionKey();
    writeCheckoutSubmissionRef({ key: fresh, cartFingerprint });
    return fresh;
  });

  const [state, formAction, pending] = useActionState<CreateCheckoutResult | null, FormData>(
    async (_prev, formData) => {
      const result = await createCheckout(formData);
      if (result.ok) {
        // Merge rather than overwrite as a safety net: an idempotent replay of
        // the SAME submission key returns the SAME (derived) credential, so a
        // lost first response — where this tab has no ticket yet — still ends
        // up with a working credential and never with a blank one that would
        // leave payment unable to authorize the order (recovery finding #1).
        const existing = readOrderTicket();
        writeOrderTicket({
          credential: result.credential ?? existing?.credential ?? '',
          checkoutId: result.checkoutId,
          orderNumber: result.orderNumber,
        });
      }
      return result;
    },
    null,
  );

  const ok = state?.ok === true;
  useEffect(() => {
    if (ok) {
      router.push(`/${locale}/checkout/payment`);
    }
  }, [ok, locale, router]);

  const flowError = state && !state.ok && state.code;
  const fieldErrors = state && !state.ok && state.code === 'validation' ? state.errors : undefined;

  const inputClass =
    'w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-pine-600 focus:outline-none focus:ring-1 focus:ring-pine-600';

  return (
    <form action={formAction} noValidate className="flex flex-col gap-6 py-8" data-testid="checkout-form">
      <input type="hidden" name="submissionKey" value={submissionKey} data-testid="checkout-submission-key" />
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-serif text-2xl font-semibold text-pine-900" data-testid="checkout-title">
          {t('checkout.title')}
        </h1>
        <Link href={`/${locale}/cart`} className="text-xs text-stone-500 underline decoration-stone-300 underline-offset-2 hover:text-lacquer-700">
          {t('checkout.backToCart')}
        </Link>
      </div>

      {flowError && flowError !== 'validation' && (
        <p role="alert" data-testid="checkout-flow-error" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {t(
            flowError === 'empty-cart'
              ? 'checkout.error.emptyCart'
              : flowError === 'out-of-stock'
                ? 'checkout.error.outOfStock'
                : 'checkout.error.unexpected',
          )}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-6">
          <section className="rounded-lg border border-stone-200 bg-white p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">{t('checkout.contactTitle')}</h2>
            <div className="mt-4 flex flex-col gap-4">
              {FIELDS.map((field) => {
                const error = fieldErrors?.[field.id];
                return (
                  <div key={field.id}>
                    <label htmlFor={field.testId} className="mb-1 block text-sm font-medium text-stone-700">
                      {t(field.labelKey)}
                      <span aria-hidden="true" className="text-lacquer-700"> *</span>
                    </label>
                    <input
                      id={field.testId}
                      name={field.name}
                      type={field.type ?? 'text'}
                      autoComplete={field.autoComplete}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? `${field.testId}-error` : undefined}
                      data-testid={field.testId}
                      className={inputClass}
                    />
                    {error && (
                      <p id={`${field.testId}-error`} role="alert" data-testid={`${field.testId}-error`} className="mt-1 text-xs text-lacquer-700">
                        {t(
                          error === 'invalidEmail'
                            ? 'checkout.error.field.invalidEmail'
                            : error === 'tooLong'
                              ? 'checkout.error.field.tooLong'
                              : error === 'invalidCountry'
                                ? 'checkout.error.field.invalidCountry'
                                : 'checkout.error.field.required',
                        )}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <p className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 text-xs leading-relaxed text-stone-500" data-testid="checkout-privacy-note">
            {t('checkout.privacyNote')}
          </p>
        </div>

        <aside className="flex flex-col gap-4">
          <div className="rounded-lg border border-stone-200 bg-white p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">{t('checkout.orderSummaryTitle')}</h2>
            <ul className="mt-4 flex flex-col divide-y divide-stone-100" data-testid="checkout-summary-lines">
              {lines.map((line) => (
                <li key={line.sku} data-testid="checkout-summary-line" data-sku={line.sku} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-stone-800 [overflow-wrap:anywhere]">{line.name}</p>
                    <p className="mt-0.5 text-xs text-stone-500 [overflow-wrap:anywhere]">
                      {line.variantName} · {line.sku} · {t('order.qtyLabel')} {line.quantity}
                    </p>
                  </div>
                  <span className="text-sm tabular-nums text-stone-700">{formatCny(line.subtotalCents, locale)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-col gap-2 border-t border-stone-200 pt-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-stone-600">{t('checkout.subtotalLabel')}</span>
                <span className="text-sm tabular-nums text-stone-800" data-testid="checkout-subtotal">{formatCny(subtotalCents, locale)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-stone-600">{t('checkout.shippingLabel')}</span>
                <span className="text-sm tabular-nums text-stone-800" data-testid="checkout-shipping">{formatCny(shippingFeeCents, locale)}</span>
              </div>
              <div className="flex items-center justify-between border-t border-stone-200 pt-2">
                <span className="text-sm font-medium text-stone-700">{t('checkout.totalLabel')}</span>
                <span className="text-base font-semibold text-pine-900" data-testid="checkout-total">{formatCny(totalCents, locale)}</span>
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={pending}
            data-testid="checkout-submit"
            className="inline-flex w-full items-center justify-center rounded-md bg-pine-700 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-pine-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? t('checkout.submitting') : t('checkout.submit')}
          </button>
          <p className="text-xs text-stone-400" data-testid="checkout-demo-payment-note">
            {t('checkout.demoPaymentNote')}
          </p>
        </aside>
      </div>
    </form>
  );
}
