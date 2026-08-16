import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { LOCALE_COOKIE, normalizeLocale } from '@/i18n/registry';

/**
 * Root "/" redirects to the visitor's persisted locale (or the registry
 * default). The locale choice is route-visible and cookie-persisted.
 */
export default async function RootPage() {
  const cookieStore = await cookies();
  const saved = cookieStore.get(LOCALE_COOKIE)?.value;
  redirect(`/${normalizeLocale(saved)}`);
}
