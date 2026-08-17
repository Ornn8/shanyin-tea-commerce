import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/lib/auth';

/**
 * better-auth HTTP surface (sign-in, sign-out, session). CSRF, rate limits,
 * and cookie handling are enforced by better-auth here; the admin UI signs in
 * and out through the client (`src/lib/auth-client.ts`).
 */
export const { GET, POST } = toNextJsHandler(auth);
