-- CreateEnum
CREATE TYPE "Category" AS ENUM ('food', 'shop', 'ent', 'trans', 'health', 'bills', 'other');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('SGD', 'USD', 'MYR', 'CNY');

-- CreateEnum
CREATE TYPE "ExpenseSource" AS ENUM ('manual', 'voice');

-- CreateEnum
CREATE TYPE "VoiceStatus" AS ENUM ('confirmed', 'edited', 'reparsed');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT,
    "currency" "Currency" NOT NULL DEFAULT 'SGD',
    "monthlySalary" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "savingsGoal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "saved" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "spentAt" TIMESTAMP(3) NOT NULL,
    "category" "Category" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'SGD',
    "note" TEXT NOT NULL,
    "fixed" BOOLEAN NOT NULL DEFAULT false,
    "source" "ExpenseSource" NOT NULL DEFAULT 'manual',
    "transcript" TEXT,
    "lang" TEXT,
    "voiceStatus" "VoiceStatus",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bonus" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "Bonus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Expense_userId_spentAt_idx" ON "Expense"("userId", "spentAt");

-- CreateIndex
CREATE INDEX "Expense_userId_category_idx" ON "Expense"("userId", "category");

-- CreateIndex
CREATE INDEX "Bonus_userId_idx" ON "Bonus"("userId");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bonus" ADD CONSTRAINT "Bonus_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
