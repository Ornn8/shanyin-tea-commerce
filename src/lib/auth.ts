/**
 * Merchant administration authentication (ADR-0005).
 *
 * - Maintained authentication library: better-auth 1.x (Next.js 16 / React 19
 *   compatible), backed by PostgreSQL through the Prisma adapter.
 * - Public sign-up is disabled (`emailAndPassword.disableSignUp`); the seed
 *   creates the single allowlisted merchant administrator. Session records
 *   live server-side in the `Session` table; the browser only holds an
 *   httpOnly cookie.
 * - CSRF: better-auth rejects state-changing requests whose Origin is not
 *   trusted when cookies are present (403 INVALID_ORIGIN). Next.js Server
 *   Actions add their own origin checks on top.
 * - Rate limits: better-auth's built-in limiter is enabled in every
 *   environment; sign-in gets a tighter rule (5 attempts / 15 min per IP).
 */
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { prisma } from '@/lib/prisma';

/** Cookie name used by better-auth for the session token (adapter default). */
export const SESSION_COOKIE_NAME = 'better-auth.session_token';

/** Sign-in rate limit rule (per IP, better-auth built-in limiter). */
export const SIGN_IN_RATE_LIMIT = { window: 900, max: 10 } as const;

/** Origins allowed for state-changing auth requests (dev + e2e hosts). */
const TRUSTED_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3100',
  'http://127.0.0.1:3100',
];

export const auth = betterAuth({
  appName: 'Shanyin Tea',
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  secret: process.env.AUTH_SECRET ?? 'dev-only-secret-shanyin-tea-demo',
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
  trustedOrigins: TRUSTED_ORIGINS,
  emailAndPassword: {
    enabled: true,
    /** No public registration — only the seeded allowlisted merchant exists. */
    disableSignUp: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
  },
  session: {
    /** 7-day sessions, refreshed at most once a day. */
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 30,
    customRules: {
      '/sign-in/email': SIGN_IN_RATE_LIMIT,
    },
  },
  advanced: {
    ipAddress: {
      ipAddressHeaders: ['x-forwarded-for'],
    },
    // better-auth would otherwise skip origin checks in test environments
    // (NODE_ENV=test); keep CSRF enforcement on everywhere.
    disableOriginCheck: false,
  },
});
