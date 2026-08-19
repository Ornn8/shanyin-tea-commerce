'use client';

import { useTransition, useState } from 'react';
import { addToCartAction } from '@/lib/cart-actions';
import { withCartLock } from '@/lib/cart-lock';

interface AddToCartProps {
  sku: string;
  label: string;
  addedLabel: string;
  /** Localized error shown when the server rejects the add (e.g. out of stock). */
  errorLabel: string;
  disabled?: boolean;
}

/**
 * Product-page add-to-cart. The quantity change is a SERVER action: the SKU is
 * re-validated against publication state, price, and shared inventory in the
 * same round trip (ADR-0007), and the signed cart cookie is written by the
 * server — the client never serializes or signs the cart. The header badge is
 * kept in sync via the `shanyin:cart` event.
 *
 * The mutation runs under the storefront-wide cart write lock
 * (`withCartLock`), so a concurrent add from ANOTHER tab cannot be silently
 * overwritten: the lock serializes every cart read-modify-write round trip
 * across all same-origin tabs, and the server action always re-reads the
 * latest committed cookie before writing (ADR-0007).
 */
export function AddToCart({ sku, label, addedLabel, errorLabel, disabled = false }: AddToCartProps) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<'idle' | 'added' | 'error'>('idle');

  function handleAdd() {
    if (pending) return;
    startTransition(async () => {
      try {
        const result = await withCartLock(() => addToCartAction(sku, 1));
        if (result.ok) {
          setState('added');
          window.dispatchEvent(new Event('shanyin:cart'));
          window.setTimeout(() => setState('idle'), 1600);
        } else {
          setState('error');
          window.setTimeout(() => setState('idle'), 2000);
        }
      } catch {
        setState('error');
        window.setTimeout(() => setState('idle'), 2000);
      }
    });
  }

  const disabledNow = disabled || pending;
  const message =
    state === 'added' ? addedLabel : state === 'error' ? errorLabel : label;

  return (
    <button
      type="button"
      onClick={handleAdd}
      disabled={disabledNow || state !== 'idle'}
      data-testid="add-to-cart"
      className="inline-flex items-center gap-2 rounded-md bg-pine-700 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-pine-800 disabled:cursor-not-allowed disabled:opacity-70"
    >
      {state === 'added' ? (
        <>
          <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 8.5 6.5 12 13 4.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {message}
        </>
      ) : (
        message
      )}
    </button>
  );
}