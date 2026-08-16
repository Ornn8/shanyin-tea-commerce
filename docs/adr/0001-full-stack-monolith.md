# ADR-0001: Full-stack monolith

- Status: Accepted
- Date: 2026-08-16

## Context

The storefront must be a production-shaped vertical slice: browser UI, localization, and a
PostgreSQL-backed catalog, all runnable from a clean install with a small command set. The
team is small and the merchant surface (one storefront, three locales) is narrow.

## Decision

Build one deployable Next.js 16 App Router application that owns the full stack:

- Server components render pages and query PostgreSQL directly through Prisma ORM (no
  separate API tier for page data).
- Route handlers are used only where a non-page boundary is genuinely needed (none exist in
  this slice — the cart is cookie-based; search is a server-rendered page).
- Localization, catalog queries, and rendering live in the same process, so a request for
  `/ja/products/liubao` is one round trip.

## Consequences

- **Positive:** one deployable, one language (TypeScript strict), one test surface, no
  network hops between UI and data; a visitor's locale + page = one request.
- **Negative:** the monolith cannot scale read path independently from the app tier; if a
  future headless/API consumer appears, query logic in `src/lib/products.ts` must be
  extracted. The Prisma client is kept in a singleton (`src/lib/prisma.ts`) to avoid
  connection exhaustion in serverless-style deployments.

## Alternatives considered

- Separate Next.js frontend + REST API + ORM service: rejected for this slice — triples
  deployment and testing surface without a demonstrated need.
- Serverless functions per page: rejected — the slice targets a single-merchant catalog with
  predictable load; a single process is simpler to operate and to verify locally.
