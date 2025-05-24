-- AlterTable
ALTER TABLE "Wallet" ADD COLUMN     "nftDatabaseId" TEXT,
ADD COLUMN     "notionPageId" TEXT,
ADD COLUMN     "receivedTransactionsDatabaseId" TEXT,
ADD COLUMN     "scheduleTransactionsDatabaseId" TEXT,
ADD COLUMN     "subWalletsDatabaseId" TEXT,
ADD COLUMN     "transactionsDatabaseId" TEXT;

-- CreateTable
CREATE TABLE "NFT" (
    "id" TEXT NOT NULL,
    "notionPageId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "attributes" JSONB,
    "description" TEXT,
    "imageUrl" TEXT,
    "receiveDate" TIMESTAMP(3),
    "transactionHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NFT_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceivedTransaction" (
    "id" TEXT NOT NULL,
    "notionPageId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "tokenName" TEXT NOT NULL,
    "transactionHash" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReceivedTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NFT_notionPageId_key" ON "NFT"("notionPageId");

-- CreateIndex
CREATE INDEX "NFT_walletId_idx" ON "NFT"("walletId");

-- CreateIndex
CREATE INDEX "NFT_notionPageId_idx" ON "NFT"("notionPageId");

-- CreateIndex
CREATE UNIQUE INDEX "ReceivedTransaction_notionPageId_key" ON "ReceivedTransaction"("notionPageId");

-- CreateIndex
CREATE INDEX "ReceivedTransaction_walletId_idx" ON "ReceivedTransaction"("walletId");

-- CreateIndex
CREATE INDEX "ReceivedTransaction_notionPageId_idx" ON "ReceivedTransaction"("notionPageId");

-- AddForeignKey
ALTER TABLE "NFT" ADD CONSTRAINT "NFT_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceivedTransaction" ADD CONSTRAINT "ReceivedTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
