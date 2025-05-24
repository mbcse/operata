/*
  Warnings:

  - A unique constraint covering the columns `[workspaceId]` on the table `WalletWorkspace` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "WalletWorkspace_workspaceId_key" ON "WalletWorkspace"("workspaceId");
