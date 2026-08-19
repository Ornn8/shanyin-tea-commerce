'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { createT } from '@/i18n/catalog';
import { formatCny } from '@/i18n/format';
import type { LocaleId } from '@/i18n/registry';
import { CART_MAX_QTY } from '@/lib/cart';
import { SHIPPING_FREE_THRESHOLD_CENTS } from '@/lib/shipping-estimate';
import {
  emptyCartAction,
  reconcileCartAction,
  removeCartItemAction,
  setCartItemQuantityAction,
} from '@/lib/cart-actions';
import type { CartLineIssue } from '@/lib/products';

/** Serializable line data resolved on the server (ADR-0007). */
export interface CartShellLine {
  sku: string;
  productName: string;
  productSlug: string;
  variantName: string;
  origin: string;
  qty: number;
  effectiveQty: number;
  inventory: number;
  snapshotPriceCents: number;
  priceCents: number;
  issues: CartLineIssue[];
}

export interface CartShellTotals {
  subtotalCents: number;
  shippingFeeCents: number;
  freeEligible: boolean;
  estimatedTotalCents: number;
}

interface CartShellProps {
  locale: LocaleId;
  lines: CartShellLine[];
  totals: CartShellTotals | null;
  /** True when the stored cart cookie was unsigned, tampered, or expired. */
  expired: boolean;
  /** True when at least one cart SKU was dropped (unavailable/unpublished). */
  removedNotice: boolean;
}

/**
 * Cart page shell — the interactive part of the cart. The server resolves
 * every line per locale (language-neutral facts + localized copy) and passes
 * the result here; ALL mutations go back through server actions that
 * re-validate publication state, price, and inventory before writing the
 * signed cookie. Locale switching re-resolves the same SKUs with new copy —
 * lines are never duplicated or dropped by locale.
 *
 * Accessibility: native buttons with localized aria labels, a live region for
 * quantity/removal announcements, and focus restored to the cart heading after
 * a removal.
 */
export function CartShell({
  locale,
  lines,
  totals,
  expired,
  removedNotice,
}: CartShellProps) {
  const t = createT(locale);
  const router = useRouter();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [pending, startTransition] = useTransition();
  const [announce, setAnnounce] = useState<{ id: number; text: string } | null>(null);

  const empty = lines.length === 0;

  // Persist the revalidated cart state this page just surfaced (ADR-0007):
  // clear an expired/void cookie, prune unpublished/unknown lines, and clamp
  // quantities to the current inventory — so the header badge cannot keep
  // showing a stale count and revealed shortages cannot reappear after stock
  // is restored. Idempotent: a cookie that already matches is left untouched.
  // There is deliberately no router.refresh() here so the localized
  // expired/removed notices the server rendered stay visible; the badge is
  // synced via the `shanyin:cart` event instead.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await reconcileCartAction();
        if (!cancelled && result.ok && result.changed) {
          window.dispatchEvent(new Event('shanyin:cart'));
        }
      } catch {
        // Display-only recovery; a transient failure just leaves the stale
        // cookie for the next cart view or mutation.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function notify(text: string) {
    setAnnounce((prev) => ({ id: (prev?.id ?? 0) + 1, text }));
  }

  function changeQuantity(sku: string, name: string, next: number) {
    if (pending || next < 1 || next > CART_MAX_QTY) return;
    startTransition(async () => {
      try {
        const result = await setCartItemQuantityAction(sku, next);
        if (result.ok) {
          window.dispatchEvent(new Event('shanyin:cart'));
          notify(t('cart.qtyChanged', { name, qty: next }));
          router.refresh();
        } else {
          notify(t('cart.updateError'));
        }
      } catch {
        notify(t('cart.updateError'));
      }
    });
  }

  function removeLine(sku: string, name: string) {
    if (pending) return;
    startTransition(async () => {
      try {
        const result = await removeCartItemAction(sku);
        if (result.ok) {
          window.dispatchEvent(new Event('shanyin:cart'));
          notify(t('cart.itemRemoved', { name }));
          // Focus restoration: return keyboard/screen-reader focus to the
          // cart heading so the shopper knows the line is gone.
          headingRef.current?.focus();
          router.refresh();
        } else {
          notify(t('cart.updateError'));
        }
      } catch {
        notify(t('cart.updateError'));
      }
    });
  }

  function clearCart() {
    if (pending) return;
    startTransition(async () => {
      try {
        const result = await emptyCartAction();
        if (result.ok) {
          window.dispatchEvent(new Event('shanyin:cart'));
          router.refresh();
        }
      } catch {
        notify(t('cart.updateError'));
      }
    });
  }

  return (
    <div className="flex flex-col gap-6 py-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1
          ref={headingRef}
          tabIndex={-1}
          data-testid="cart-title"
          className="font-serif text-2xl font-semibold text-pine-900 focus:outline-none"
        >
          {t('cart.title')}
        </h1>
        {!empty && (
          <button
            type="button"
            onClick={clearCart}
            disabled={pending}
            data-testid="cart-empty-cart"
            className="text-xs text-stone-500 underline decoration-stone-300 underline-offset-2 hover:text-lacquer-700"
          >
            {t('cart.emptyCart')}
          </button>
        )}
      </div>

      {expired && (
        <p
          role="alert"
          data-testid="cart-expired"
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          {t('cart.expiredNotice')}
        </p>
      )}

      {/* Shown even when dropped lines leave the cart empty, so the shopper
          knows the line list changed. */}
      {removedNotice && (
        <p
          data-testid="cart-removed-notice"
          className="rounded-lg border border-stone-200 bg-stone-100 px-4 py-3 text-sm text-stone-600"
        >
          {t('cart.removedNotice')}
        </p>
      )}

      {empty ? (
        <div className="rounded-xl border border-dashed border-stone-300 bg-white p-10 text-center">
          <p className="text-sm text-stone-500" data-testid="cart-empty">
            {t('cart.empty')}
          </p>
          <Link
            href={`/${locale}/products`}
            className="mt-4 inline-flex rounded-md bg-pine-700 px-4 py-2 text-sm font-medium text-white hover:bg-pine-800"
          >
            {t('home.heroCta')}
          </Link>
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-3" data-testid="cart-items">
            {lines.map((line) => {
              const decrementDisabled = pending || line.effectiveQty <= 1;
              const incrementDisabled =
                pending || line.effectiveQty >= line.inventory || line.effectiveQty >= CART_MAX_QTY;
              return (
                <li
                  key={line.sku}
                  data-testid="cart-line"
                  data-sku={line.sku}
                  className="flex flex-col gap-3 rounded-lg border border-stone-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/${locale}/products/${line.productSlug}`}
                      className="font-serif text-base font-semibold text-pine-900 hover:text-pine-700 [overflow-wrap:anywhere]"
                    >
                      {line.productName}
                    </Link>
                    <p className="mt-0.5 text-xs text-stone-500">
                      <span className="[overflow-wrap:anywhere]">{line.variantName}</span>
                      <span aria-hidden="true"> · </span>
                      <span className="[overflow-wrap:anywhere]">{line.sku}</span>
                      <span aria-hidden="true"> · </span>
                      <span className="[overflow-wrap:anywhere]">{line.origin}</span>
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span className="text-sm font-medium text-stone-800" data-testid="cart-line-price" data-sku={line.sku}>
                        {formatCny(line.priceCents, locale)}
                      </span>
                      <div className="inline-flex items-center gap-1 rounded-md border border-stone-200 p-0.5">
                        <button
                          type="button"
                          onClick={() => changeQuantity(line.sku, line.productName, line.effectiveQty - 1)}
                          disabled={decrementDisabled}
                          data-testid={`cart-qty-decrease-${line.sku}`}
                          aria-label={t('cart.qtyDecrease', { name: line.productName })}
                          className="inline-flex h-7 w-7 items-center justify-center rounded text-stone-600 transition-colors hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          −
                        </button>
                        <span
                          data-testid={`cart-qty-${line.sku}`}
                          aria-label={`${t('cart.qtyLabel')}: ${line.effectiveQty}`}
                          className="min-w-6 text-center text-sm tabular-nums text-stone-800"
                        >
                          {line.effectiveQty}
                        </span>
                        <button
                          type="button"
                          onClick={() => changeQuantity(line.sku, line.productName, line.effectiveQty + 1)}
                          disabled={incrementDisabled}
                          data-testid={`cart-qty-increase-${line.sku}`}
                          aria-label={t('cart.qtyIncrease', { name: line.productName })}
                          className="inline-flex h-7 w-7 items-center justify-center rounded text-stone-600 transition-colors hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          +
                        </button>
                      </div>
                      <span className="text-sm font-semibold text-stone-900" data-testid={`cart-line-total-${line.sku}`}>
                        {formatCny(line.effectiveQty * line.priceCents, locale)}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeLine(line.sku, line.productName)}
                        disabled={pending}
                        data-testid={`cart-remove-${line.sku}`}
                        className="text-xs text-lacquer-700 underline decoration-lacquer-200 underline-offset-2 hover:text-lacquer-800"
                      >
                        {t('cart.remove')}
                      </button>
                    </div>
                  </div>
                  {line.issues.length > 0 && (
                    <ul className="flex flex-col gap-1 text-xs" data-testid={`cart-issues-${line.sku}`}>
                      {line.issues.includes('price-changed') && (
                        <li data-testid={`cart-price-changed-${line.sku}`} className="text-amber-700">
                          {t('cart.priceChanged', {
                            oldPrice: formatCny(line.snapshotPriceCents, locale),
                            newPrice: formatCny(line.priceCents, locale),
                          })}
                        </li>
                      )}
                      {line.issues.includes('insufficient-stock') && (
                        <li data-testid={`cart-insufficient-stock-${line.sku}`} className="text-amber-700">
                          {line.inventory > 0
                            ? t('cart.insufficientStock', { available: line.inventory, qty: line.effectiveQty })
                            : t('cart.outOfStock')}
                        </li>
                      )}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="flex flex-col gap-3 rounded-lg border border-stone-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-stone-600">{t('cart.subtotal')}</span>
              <span className="price-ticket text-base" data-testid="cart-total">
                {formatCny(totals!.subtotalCents, locale)}
              </span>
            </div>
            <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm text-stone-600" data-testid="cart-shipping-label">
                {t('cart.shippingEstimate')}
                {totals!.freeEligible && (
                  <span className="ml-2 text-xs text-pine-700" data-testid="cart-shipping-free-note">
                    {t('cart.shippingFreeNote', { amount: formatCny(SHIPPING_FREE_THRESHOLD_CENTS, locale) })}
                  </span>
                )}
              </span>
              <span className="text-sm font-medium text-stone-800" data-testid="cart-shipping">
                {formatCny(totals!.shippingFeeCents, locale)}
              </span>
            </div>
            <div className="flex items-center justify-between border-t border-stone-200 pt-3">
              <span className="text-sm font-medium text-stone-700">{t('cart.estimatedTotal')}</span>
              <span className="text-base font-semibold text-pine-900" data-testid="cart-estimated-total">
                {formatCny(totals!.estimatedTotalCents, locale)}
              </span>
            </div>
            <p className="text-xs text-stone-400">{t('product.cartDemoNote')}</p>
          </div>
        </>
      )}

      {/* Screen-reader announcement region (polite). */}
      {announce && (
        <p
          key={announce.id}
          role="status"
          data-testid="cart-live"
          className="sr-only"
        >
          {announce.text}
        </p>
      )}
    </div>
  );
}