'use client';

import { useRouter } from 'next/navigation';
import { CART_COOKIE, readCartCookie, serializeCart } from '@/lib/cart';

interface RemoveFromCartProps {
  sku: string;
  label: string;
}

export function RemoveFromCart({ sku, label }: RemoveFromCartProps) {
  const router = useRouter();

  function remove() {
    const next = readCartCookie(document.cookie).filter((item) => item !== sku);
    document.cookie = `${CART_COOKIE}=${encodeURIComponent(serializeCart(next))}; Path=/; Max-Age=2592000; SameSite=Lax`;
    window.dispatchEvent(new Event('shanyin:cart'));
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={remove}
      className="text-xs text-lacquer-700 underline decoration-lacquer-200 underline-offset-2 hover:text-lacquer-800"
    >
      {label}
    </button>
  );
}
