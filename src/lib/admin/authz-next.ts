/**
 * Next.js wrappers around the testable authorization guard. Server
 * components and server actions import these; integration tests import
 * `authz.ts` directly with constructed Headers.
 */
import { headers } from 'next/headers';
import { AdminAuthError, getSessionForHeaders, type AdminSession } from './authz';

export async function getAdminSession(): Promise<AdminSession | null> {
  return getSessionForHeaders(await headers());
}

export async function requireAdminOrThrow(): Promise<AdminSession> {
  const session = await getAdminSession();
  if (!session) throw new AdminAuthError();
  return session;
}
