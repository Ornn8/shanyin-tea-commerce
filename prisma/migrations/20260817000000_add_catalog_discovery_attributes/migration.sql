-- Add language-neutral catalog discovery attributes (ADR-0004).
-- Leaf form and caffeine level are product facts shared by every locale;
-- their display labels are localized message keys, never stored per locale.

-- CreateEnum
CREATE TYPE "ProductForm" AS ENUM ('LOOSE', 'COMPRESSED');

-- CreateEnum
CREATE TYPE "CaffeineLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "form" "ProductForm" NOT NULL DEFAULT 'LOOSE',
ADD COLUMN     "caffeine" "CaffeineLevel" NOT NULL DEFAULT 'MEDIUM';
