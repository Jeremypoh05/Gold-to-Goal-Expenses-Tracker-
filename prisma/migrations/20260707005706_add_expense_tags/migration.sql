-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
