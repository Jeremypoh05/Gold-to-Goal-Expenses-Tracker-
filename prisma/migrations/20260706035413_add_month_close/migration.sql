-- CreateTable
CREATE TABLE "MonthClose" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonthClose_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MonthClose_userId_idx" ON "MonthClose"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MonthClose_userId_year_month_key" ON "MonthClose"("userId", "year", "month");

-- AddForeignKey
ALTER TABLE "MonthClose" ADD CONSTRAINT "MonthClose_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
