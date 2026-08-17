'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';

/** Sign-in form backed by the better-auth client (rate-limited + CSRF-protected). */
export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = await authClient.signIn.email({
        email: email.trim(),
        password,
        callbackURL: '/admin/products',
      });
      if (result.error) {
        setError(result.error.message ?? 'Sign-in failed.');
        return;
      }
      router.push('/admin/products');
      router.refresh();
    } catch {
      setError('Sign-in failed. Please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4" data-testid="login-form">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-stone-700">Email</span>
        <input
          type="email"
          name="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="rounded-md border border-stone-300 px-3 py-2 text-stone-900 focus:border-pine-500 focus:outline-none focus:ring-2 focus:ring-pine-200"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-stone-700">Password</span>
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="rounded-md border border-stone-300 px-3 py-2 text-stone-900 focus:border-pine-500 focus:outline-none focus:ring-2 focus:ring-pine-200"
        />
      </label>
      {error ? (
        <p role="alert" className="rounded-md border border-lacquer-200 bg-lacquer-50 px-3 py-2 text-sm text-lacquer-800" data-testid="login-error">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-pine-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-pine-800 disabled:opacity-60"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
