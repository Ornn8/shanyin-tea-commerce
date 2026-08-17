import Link from 'next/link';
import { Seal } from '@/components/seal';
import { SignOutButton } from './sign-out-button';

interface AdminHeaderProps {
  email: string;
}

/** Admin chrome header: brand, storefront link, signed-in merchant, sign-out. */
export function AdminHeader({ email }: AdminHeaderProps) {
  return (
    <header className="border-b border-stone-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2.5">
          <Seal glyph="山" className="h-8 w-8 rounded-md" label="Shanyin" />
          <span className="flex flex-col leading-tight">
            <span className="font-serif text-base font-semibold tracking-wide text-pine-900">
              Shanyin Tea
            </span>
            <span className="text-[11px] uppercase tracking-[0.18em] text-stone-500">
              Merchant administration
            </span>
          </span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="hidden text-stone-500 sm:inline" data-testid="admin-email">
            {email}
          </span>
          <Link
            href="/en"
            className="rounded-md border border-stone-200 px-3 py-1.5 text-stone-700 transition-colors hover:border-pine-300 hover:text-pine-700"
          >
            Storefront
          </Link>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
