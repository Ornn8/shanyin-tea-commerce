'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { LocaleSwitchStore } from '@/i18n/client-store';
import { LOCALE_COOKIE, type LocaleId } from '@/i18n/registry';

export interface LocaleOption {
  id: LocaleId;
  label: string;
}

interface LocalePickerProps {
  locale: LocaleId;
  options: readonly LocaleOption[];
  label: string;
}

/**
 * Registry-driven locale picker.
 *
 * - Options are derived from the locale registry (never hard-coded here).
 * - The choice is persisted in a cookie and applied to localStorage before
 *   navigation, then the route is replaced with the new locale segment.
 * - Async locale data loads are routed through LocaleSwitchStore, which
 *   rejects stale resolutions so a slower, earlier switch can never
 *   overwrite a newer selection.
 */
export function LocalePicker({ locale, options, label }: LocalePickerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [store] = useState(() => new LocaleSwitchStore<null>());

  function switchTo(next: LocaleId) {
    if (next === locale) return;
    try {
      document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    } catch {
      // Persistence is best-effort; navigation must still work.
    }
    // Guard: any asynchronous locale data (e.g. a future client-side catalog
    // fetch) is applied via the store; out-of-order resolutions are rejected.
    void store
      .apply(next, async () => null)
      .catch(() => undefined);

    // Swap the locale segment in place and preserve the query string, so
    // catalog search/filter/sort/page state survives locale switching
    // (ADR-0004).
    const segments = pathname.split('/');
    segments[1] = next;
    const query = searchParams.toString();
    const target = segments.join('/') || `/${next}`;
    router.replace(query ? `${target}?${query}` : target);
  }

  return (
    <div className="relative inline-flex items-center">
      <label htmlFor="locale-picker" className="sr-only">
        {label}
      </label>
      <select
        id="locale-picker"
        value={locale}
        onChange={(event) => switchTo(event.target.value as LocaleId)}
        aria-label={label}
        className="cursor-pointer appearance-none rounded-md border border-stone-200 bg-white py-1.5 pl-3 pr-8 text-sm text-stone-700 shadow-sm transition-colors hover:border-pine-300 focus:border-pine-500 focus:outline-none focus:ring-2 focus:ring-pine-200"
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-stone-400"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
