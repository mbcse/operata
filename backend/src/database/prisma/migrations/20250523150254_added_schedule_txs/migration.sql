-- CreateTable
CREATE TABLE "ScheduledTransaction" (
    "id" TEXT NOT NULL,
    "notionPageId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "transactionName" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "scheduleDate" TIMESTAMP(3) NOT NULL,
    "adminStatus" TEXT NOT NULL,
    "operataStatus" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledTransaction_notionPageId_key" ON "ScheduledTransaction"("notionPageId");

-- CreateIndex
CREATE INDEX "ScheduledTransaction_walletId_idx" ON "ScheduledTransaction"("walletId");

-- CreateIndex
CREATE INDEX "ScheduledTransaction_notionPageId_idx" ON "ScheduledTransaction"("notionPageId");

-- AddForeignKey
ALTER TABLE "ScheduledTransaction" ADD CONSTRAINT "ScheduledTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
