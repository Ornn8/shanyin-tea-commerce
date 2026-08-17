import type { ReactNode } from 'react';
import '../globals.css';

/**
 * Root layout for the merchant administration surface. The guard lives one
 * level down in `(protected)/layout.tsx` so `/admin/login` stays reachable
 * for unauthenticated visitors.
 */
export default function AdminRootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-stone-50 text-stone-900 antialiased">{children}</body>
    </html>
  );
}