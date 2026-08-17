import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getAdminSession } from '@/lib/admin/authz-next';
import { AdminHeader } from '@/components/admin/admin-header';

/**
 * Guard for the merchant administration surface (ADR-0005): without an
 * allowlisted admin session the visitor is redirected to the sign-in page.
 * Every commerce page and mutation sits under this layout.
 */
export default async function AdminProtectedLayout({ children }: { children: ReactNode }) {
  const session = await getAdminSession();
  if (!session) redirect('/admin/login');

  return (
    <>
      <a
        href="#admin-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-pine-800 focus:px-4 focus:py-2 focus:text-sm focus:text-white"
      >
        Skip to content
      </a>
      <AdminHeader email={session.user.email} />
      <main id="admin-main" className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        {children}
      </main>
    </>
  );
}