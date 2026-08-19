-- Deterministic variant order (ADR-0006).
--
-- ProductVariant.createdAt defaults to CURRENT_TIMESTAMP, which PostgreSQL
-- evaluates once per transaction (the transaction start time), so variants
-- created together in one transaction all tie on createdAt. ORDER BY createdAt
-- alone then leaves the row order — and therefore which variant the storefront
-- treats as the default (variants[0] = default SKU, price, availability) —
-- nondeterministic. Persist an explicit 0-based position instead and order by
-- it everywhere.

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;

-- Backfill: keep each variant's current relative order within its product,
-- using id as the stable tiebreaker for rows that share a createdAt.
WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "productId"
      ORDER BY "createdAt" ASC, "id" ASC
    ) - 1 AS "position"
  FROM "ProductVariant"
)
UPDATE "ProductVariant" AS variant
SET "position" = ranked."position"
FROM ranked
WHERE variant."id" = ranked."id";

-- Read paths filter by productId and order by position.
CREATE INDEX "ProductVariant_productId_position_idx" ON "ProductVariant"("productId", "position");

-- DropIndex: superseded by the compound index above.
DROP INDEX "ProductVariant_productId_idx";