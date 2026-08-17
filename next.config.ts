import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // better-auth bundles optional database adapters (kysely/drizzle/mongo/
  // memory) whose packages are not all installed here; externalizing the
  // package lets Node resolve "better-auth" at runtime with pnpm's symlinks,
  // exactly like the test runner does.
  serverExternalPackages: ['better-auth'],
};

export default nextConfig;