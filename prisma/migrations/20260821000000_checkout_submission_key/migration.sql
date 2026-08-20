-- Checkout submission idempotency key (Issue #6, ADR-0008).
--
-- Adds the client-provided UNIQUE submission key that makes order creation
-- idempotent: one checkout submission always maps to exactly one order. A
-- replayed submission (retry after a network loss, a double-click, a re-submit)
-- returns the EXISTING order instead of inserting a duplicate order (and
-- duplicate personal data) for one checkout.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "submissionKey" TEXT NOT NULL DEFAULT '';

-- Backfill any rows created before this key existed (defensive: the pilot only
-- creates orders through the checkout flow, which now always supplies a key).
UPDATE "Order" SET "submissionKey" = 'legacy-' || "id" WHERE "submissionKey" = '';

-- DropDefault
ALTER TABLE "Order" ALTER COLUMN "submissionKey" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "Order_submissionKey_key" ON "Order"("submissionKey");
