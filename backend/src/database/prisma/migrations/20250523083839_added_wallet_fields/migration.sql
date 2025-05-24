-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "notionPageId" TEXT;

-- AlterTable
ALTER TABLE "Wallet" ADD COLUMN     "balance" TEXT NOT NULL DEFAULT '0',
ADD COLUMN     "lastSyncAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "WalletKeyPair" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "privateKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletKeyPair_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WalletKeyPair_walletId_key" ON "WalletKeyPair"("walletId");

-- CreateIndex
CREATE INDEX "WalletKeyPair_walletId_idx" ON "WalletKeyPair"("walletId");

-- CreateIndex
CREATE INDEX "Transaction_notionPageId_idx" ON "Transaction"("notionPageId");

-- AddForeignKey
ALTER TABLE "WalletKeyPair" ADD CONSTRAINT "WalletKeyPair_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
