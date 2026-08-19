'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { readCartForDisplay } from '@/lib/cart';

interface CartButtonProps {
  href: string;
  label: string;
}

/**
 * Header cart badge. The count is a client-side convenience: it decodes the
 * signed cart cookie WITHOUT verifying it (presentation only — the server is
 * authoritative on every cart page render and every mutation). It updates on
 * the `shanyin:cart` event (dispatched after successful server actions) and on
 * cross-tab `storage` changes.
 */
export function CartButton({ href, label }: CartButtonProps) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const read = () => {
      const items = readCartForDisplay(document.cookie);
      setCount(items.reduce((sum, item) => sum + item.qty, 0));
    };
    read();
    window.addEventListener('shanyin:cart', read);
    window.addEventListener('storage', read);
    return () => {
      window.removeEventListener('shanyin:cart', read);
      window.removeEventListener('storage', read);
    };
  }, []);

  return (
    <Link
      href={href}
      className="relative inline-flex items-center gap-1.5 rounded-md border border-stone-200 bg-white px-3 py-1.5 text-sm text-stone-700 shadow-sm transition-colors hover:border-pine-300 hover:text-pine-700"
      aria-label={`${label}${count > 0 ? ` (${count})` : ''}`}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      >
        <path
          d="M6 7h12l-1.2 12.2a1.5 1.5 0 0 1-1.5 1.3H8.7a1.5 1.5 0 0 1-1.5-1.3L6 7Z"
          strokeLinejoin="round"
        />
        <path d="M9 10V6a3 3 0 0 1 6 0v4" strokeLinecap="round" />
      </svg>
      <span>{label}</span>
      {count > 0 && (
        <span
          data-testid="cart-count"
          className="absolute -right-1.5 -top-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-lacquer-600 px-1 text-[11px] font-semibold text-white"
        >
          {count}
        </span>
      )}
    </Link>
  );
}