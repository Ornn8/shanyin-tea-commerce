-- Checkout cart generation idempotency (Issue #6, ADR-0008, review finding d49e4cb P1 #1).
--
-- Enforces cross-tab idempotency: two tabs sharing the same signed cart
-- (same fingerprint) must not create two different orders with different
-- submission keys. The fingerprint is the hash of the signed cart cookie at
-- checkout time, stored per order. Only PENDING/PAID orders hold the
-- fingerprint contested — a terminal order (FAILED/EXPIRED/CANCELLED/REFUNDED)
-- releases it so a retry from the kept cart can create a fresh order.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "cartFingerprint" TEXT;

-- CreateIndex
CREATE INDEX "Order_cartFingerprint_idx" ON "Order"("cartFingerprint");

-- Partial unique: one cart generation maps to at most one open (PENDING/PAID) order.
CREATE UNIQUE INDEX "Order_cartFingerprint_pending_paid_unique" ON "Order"("cartFingerprint") WHERE "cartFingerprint" IS NOT NULL AND status IN ('PENDING', 'PAID');
