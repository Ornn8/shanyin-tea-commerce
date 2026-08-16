import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center gap-4 py-24 text-center">
      <p className="font-serif text-5xl font-semibold text-pine-200">404</p>
      <h1 className="font-serif text-xl font-semibold text-pine-900">Page not found · 页面未找到 · ページが見つかりません</h1>
      <Link href="/" className="rounded-md bg-pine-700 px-4 py-2 text-sm font-medium text-white hover:bg-pine-800">
        Home · 首页 · ホーム
      </Link>
    </div>
  );
}
