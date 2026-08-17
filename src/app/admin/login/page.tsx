import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getAdminSession } from '@/lib/admin/authz-next';
import { LoginForm } from '@/components/admin/login-form';

export const metadata: Metadata = {
  title: 'Merchant sign-in · Shanyin Tea',
};

/**
 * Admin sign-in. Public registration is disabled (better-auth
 * `disableSignUp`); only the seeded allowlisted merchant can authenticate.
 * Already-authenticated visitors are bounced to the product list.
 */
export default async function AdminLoginPage() {
  const session = await getAdminSession();
  if (session) redirect('/admin/products');

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col justify-center">
      <div className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="font-serif text-xl font-semibold text-pine-900">
          Merchant sign-in
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          Private administration for Shanyin Tea. Public registration is disabled.
        </p>
        <LoginForm />
      </div>
    </div>
  );
}
