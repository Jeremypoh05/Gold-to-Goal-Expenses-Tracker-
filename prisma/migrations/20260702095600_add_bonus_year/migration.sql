-- DropIndex
DROP INDEX "Bonus_userId_idx";

-- AlterTable
ALTER TABLE "Bonus" ADD COLUMN     "year" INTEGER NOT NULL DEFAULT 2026;

-- CreateIndex
CREATE INDEX "Bonus_userId_year_idx" ON "Bonus"("userId", "year");
