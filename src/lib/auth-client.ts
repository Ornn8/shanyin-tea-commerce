'use client';

/**
 * better-auth client used by the admin sign-in form and sign-out button.
 * Cookies (httpOnly session cookie) are managed by the browser automatically.
 */
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient();
