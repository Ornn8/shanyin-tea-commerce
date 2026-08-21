'use client';

import { createT } from '@/i18n/catalog';
import { formatCny } from '@/i18n/format';
import type { LocaleId } from '@/i18n/registry';
import type { OrderView } from '@/lib/order-view';

interface OrderDetailsProps {
  locale: LocaleId;
  order: OrderView;
}

/** Date formatting is presentation-only (ADR-0003): the stored timestamp never
 * changes with the locale. */
function formatDate(iso: string, locale: LocaleId): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

/**
 * Renders one stored order immutably: order number, placed date, status,
 * snapshot order lines, totals (integer CNY cents formatted per locale), and
 * the shipping-to block. The status id and every amount come from the stored
 * order — locale changes copy only, never totals, identifiers, or state
 * (ADR-0003/0008). Shared by the confirmation and lookup surfaces.
 */
export function OrderDetails({ locale, order }: OrderDetailsProps) {
  const t = createT(locale);
  return (
    <div className="flex flex-col gap-4" data-testid="order-details">
      <div className="flex flex-col gap-1 rounded-lg border border-stone-200 bg-white p-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-stone-500">
            {t('order.orderNumberLabel')}
          </p>
          <p className="mt-0.5 text-base font-semibold text-pine-900" data-testid="order-order-number">
            {order.orderNumber}
          </p>
          <p className="mt-1 text-xs text-stone-500">
            <span className="mr-2">{t('order.placedLabel')}</span>
            <span data-testid="order-placed">{formatDate(order.createdAt, locale)}</span>
          </p>
        </div>
        <div className="mt-2 sm:mt-0 sm:text-right">
          <p className="text-xs uppercase tracking-wide text-stone-500">{t('order.statusLabel')}</p>
          <p
            data-testid="order-status"
            className="mt-0.5 inline-flex rounded-full bg-pine-50 px-2.5 py-0.5 text-sm font-medium text-pine-800"
          >
            {t(`order.status.${order.status.toLowerCase() as 'pending' | 'paid' | 'failed' | 'expired' | 'cancelled' | 'refunded'}`)}
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-stone-200 bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
          {t('order.itemsTitle')}
        </h2>
        <ul className="mt-3 flex flex-col divide-y divide-stone-100" data-testid="order-lines">
          {order.lines.map((line) => (
            <li
              key={line.sku}
              data-testid="order-line"
              data-sku={line.sku}
              className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="font-serif text-sm font-medium text-pine-900 [overflow-wrap:anywhere]">
                  {line.name}
                </p>
                <p className="mt-0.5 text-xs text-stone-500">
                  <span className="[overflow-wrap:anywhere]">{line.variantName}</span>
                  <span aria-hidden="true"> · </span>
                  <span className="[overflow-wrap:anywhere]">{line.sku}</span>
                </p>
              </div>
              <div className="mt-1 flex items-center justify-between gap-4 sm:mt-0 sm:justify-end">
                <span className="text-xs text-stone-500" data-testid={`order-line-qty-${line.sku}`}>
                  {t('order.qtyLabel')} {line.quantity}
                </span>
                <span className="text-sm tabular-nums text-stone-700" data-testid={`order-line-unit-${line.sku}`}>
                  {formatCny(line.unitPriceCents, locale)}
                </span>
                <span className="w-24 text-right text-sm font-medium tabular-nums text-stone-900" data-testid={`order-line-total-${line.sku}`}>
                  {formatCny(line.subtotalCents, locale)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-stone-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-stone-600">{t('order.subtotalLabel')}</span>
          <span className="text-sm tabular-nums text-stone-800" data-testid="order-subtotal">
            {formatCny(order.subtotalCents, locale)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-stone-600">{t('order.shippingLabel')}</span>
          <span className="text-sm tabular-nums text-stone-800" data-testid="order-shipping">
            {formatCny(order.shippingFeeCents, locale)}
          </span>
        </div>
        <div className="flex items-center justify-between border-t border-stone-200 pt-3">
          <span className="text-sm font-medium text-stone-700">{t('order.totalLabel')}</span>
          <span className="text-base font-semibold text-pine-900" data-testid="order-total">
            {formatCny(order.totalCents, locale)}
          </span>
        </div>
        <p className="text-xs text-stone-400" data-testid="order-demo-note">
          {t('order.demoNote')}
        </p>
      </div>

      <div className="rounded-lg border border-stone-200 bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
          {t('order.shippingToTitle')}
        </h2>
        <address className="mt-2 text-sm not-italic text-stone-700" data-testid="order-shipping-address">
          <span className="block [overflow-wrap:anywhere]">{order.recipientName}</span>
          <span className="block [overflow-wrap:anywhere]">{order.email}</span>
          <span className="block [overflow-wrap:anywhere]">{order.addressLine1}</span>
          <span className="block [overflow-wrap:anywhere]">
            {order.city}, {order.region} {order.postalCode}
          </span>
          <span className="block [overflow-wrap:anywhere]">{order.countryCode}</span>
        </address>
      </div>
    </div>
  );
}
