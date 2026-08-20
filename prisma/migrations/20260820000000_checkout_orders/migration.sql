-- Pilot checkout, idempotent orders, and secure customer lookup (Issue #6,
-- ADR-0008).
--
-- Adds the explicit payment state machine (OrderStatus with `pending` as the
-- only open state), immutable order-line snapshots, and the processed-event
-- log whose unique (gateway, providerEventId) key makes gateway events
-- idempotent and replay-safe — a duplicate or reordered delivery can never
-- create a duplicate order or double-decrement stock (stock itself is
-- decremented exactly once, inside the transaction that applies a `succeeded`
-- event to a `pending` order).

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'EXPIRED', 'CANCELLED', 'REFUNDED');

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "subtotalCents" INTEGER NOT NULL,
    "shippingFeeCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "recipientName" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "lookupHash" TEXT NOT NULL,
    "gateway" TEXT NOT NULL DEFAULT 'simulated',
    "providerIntentId" TEXT NOT NULL,
    "failureReason" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "variantName" TEXT NOT NULL,
    "nameZhCn" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameJa" TEXT NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "subtotalCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',

    CONSTRAINT "OrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "gateway" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventCreatedAt" TIMESTAMP(3),
    "signatureVerified" BOOLEAN NOT NULL,
    "resultStatus" "OrderStatus" NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Order_lookupHash_key" ON "Order"("lookupHash");

-- CreateIndex
CREATE UNIQUE INDEX "Order_providerIntentId_key" ON "Order"("providerIntentId");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");

-- CreateIndex
CREATE INDEX "OrderLine_orderId_idx" ON "OrderLine"("orderId");

-- CreateIndex
CREATE INDEX "OrderLine_sku_idx" ON "OrderLine"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentEvent_gateway_providerEventId_key" ON "PaymentEvent"("gateway", "providerEventId");

-- CreateIndex
CREATE INDEX "PaymentEvent_orderId_idx" ON "PaymentEvent"("orderId");

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
