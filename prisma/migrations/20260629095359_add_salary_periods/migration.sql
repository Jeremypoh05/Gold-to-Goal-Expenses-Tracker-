-- CreateTable
CREATE TABLE "SalaryPeriod" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "effectiveYear" INTEGER NOT NULL,
    "effectiveMonth" INTEGER NOT NULL,
    "monthlySalary" DECIMAL(12,2) NOT NULL,
    "grossSalary" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "deductions" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalaryPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalaryPeriod_userId_idx" ON "SalaryPeriod"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SalaryPeriod_userId_effectiveYear_effectiveMonth_key" ON "SalaryPeriod"("userId", "effectiveYear", "effectiveMonth");

-- AddForeignKey
ALTER TABLE "SalaryPeriod" ADD CONSTRAINT "SalaryPeriod_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill (Phase 9): seed one initial salary period per user from the deprecated
-- User.monthlySalary/grossSalary/deductions, effective from the user's signup month.
-- Only users with a salary set get a period (a 0 salary = empty start, no period).
INSERT INTO "SalaryPeriod" ("userId", "effectiveYear", "effectiveMonth", "monthlySalary", "grossSalary", "deductions", "label", "createdAt", "updatedAt")
SELECT
    "id",
    EXTRACT(YEAR FROM "createdAt")::int,
    EXTRACT(MONTH FROM "createdAt")::int,
    "monthlySalary",
    "grossSalary",
    "deductions",
    'Initial',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "User"
WHERE "monthlySalary" > 0;
