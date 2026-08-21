-- Checkout cart line identity (Issue #6, ADR-0008, review finding 4fc6050).
--
-- Binds each order line to the exact cart line generation (`CartItem.addedAt`)
-- that was purchased so PAID cleanup can match it exactly instead of comparing
-- with `paidAt`. Without this, a replacement created after order creation but
-- before payment (new addedAt still < paidAt) would be deleted as if it were
-- the purchased line.

-- AlterTable
ALTER TABLE "OrderLine" ADD COLUMN "sourceAddedAt" BIGINT;
