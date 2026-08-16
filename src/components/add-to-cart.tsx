'use client';

import { useState } from 'react';
import { CART_COOKIE, readCartCookie, serializeCart } from '@/lib/cart';

interface AddToCartProps {
  sku: string;
  label: string;
  addedLabel: string;
  disabled?: boolean;
}

export function AddToCart({ sku, label, addedLabel, disabled = false }: AddToCartProps) {
  const [added, setAdded] = useState(false);

  function handleAdd() {
    const current = readCartCookie(document.cookie);
    if (!current.includes(sku)) {
      const next = [...current, sku];
      document.cookie = `${CART_COOKIE}=${encodeURIComponent(serializeCart(next))}; Path=/; Max-Age=2592000; SameSite=Lax`;
      window.dispatchEvent(new Event('shanyin:cart'));
    }
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1600);
  }

  return (
    <button
      type="button"
      onClick={handleAdd}
      disabled={disabled || added}
      data-testid="add-to-cart"
      className="inline-flex items-center gap-2 rounded-md bg-pine-700 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-pine-800 disabled:cursor-not-allowed disabled:opacity-70"
    >
      {added ? (
        <>
          <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 8.5 6.5 12 13 4.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {addedLabel}
        </>
      ) : (
        label
      )}
    </button>
  );
}
