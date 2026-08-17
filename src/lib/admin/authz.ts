/**
 * Authorization guard for the merchant administration surface (ADR-0005).
 *
 * `getSessionForHeaders` is pure server logic (no Next.js imports) so the
 * integration suite can exercise it with plain `Headers` objects: no cookie,
 * a forged cookie, a valid session, and a session belonging to a non-
 * allowlisted user are all covered by tests.
 */
import { auth } from '@/lib/auth';

/** The single allowlisted merchant administrator email. */
export const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'merchant@shanyin.example';

export interface AdminSession {
  user: {
    id: string;
    email: string;
    name: string;
  };
}

export class AdminAuthError extends Error {
  constructor(message = 'Merchant sign-in required.') {
    super(message);
    this.name = 'AdminAuthError';
  }
}

/** Resolve the session from raw request headers; allowlist-enforced. */
export async function getSessionForHeaders(headersInit: Headers): Promise<AdminSession | null> {
  let session: Awaited<ReturnType<typeof auth.api.getSession>>;
  try {
    session = await auth.api.getSession({ headers: headersInit });
  } catch {
    return null;
  }
  if (!session?.user) return null;
  // Defense in depth: even if another account ever existed, only the
  // allowlisted merchant administrator may act here.
  if (session.user.email !== ADMIN_EMAIL) return null;
  return {
    user: { id: session.user.id, email: session.user.email, name: session.user.name },
  };
}

/** `getSessionForHeaders` but throws for unauthorized callers. */
export async function requireAdminForHeaders(headersInit: Headers): Promise<AdminSession> {
  const session = await getSessionForHeaders(headersInit);
  if (!session) throw new AdminAuthError();
  return session;
}
