import { SuiWalletService } from '../walletService/suiWallet';
import { prisma } from '@/database';
import { NotionService } from '../notion';
import { Logger } from './logger';
import { SuiEvent } from '@mysten/sui.js/client';

export class TransactionMonitor {
    private suiWalletService: SuiWalletService;
    private isRunning: boolean = false;
    private checkInterval: NodeJS.Timeout | null = null;
    private readonly CHECK_INTERVAL_MS = 30000; // Check every 30 seconds

    constructor() {
        this.suiWalletService = new SuiWalletService();
    }

    async start() {
        if (this.isRunning) {
            Logger.warn('TransactionMonitor', 'Monitor is already running');
            return;
        }

        Logger.info('TransactionMonitor', 'Starting transaction monitor');
        this.isRunning = true;

        // Initial check
        await this.checkTransactions();

        // Set up interval for regular checks
        this.checkInterval = setInterval(async () => {
            await this.checkTransactions();
        }, this.CHECK_INTERVAL_MS);
    }

    async stop() {
        if (!this.isRunning) {
            return;
        }

        Logger.info('TransactionMonitor', 'Stopping transaction monitor');
        this.isRunning = false;

        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
    }

    private async checkTransactions() {
        try {
            Logger.info('TransactionMonitor', 'Checking for new transactions');

            // Get all wallets
            const wallets = await prisma.wallet.findMany({
                include: {
                    workspace: true
                }
            });

            for (const wallet of wallets) {
                try {
                    // Get the Notion service instance for this wallet
                    const notionService = new NotionService(wallet.workspace.notionToken);

                    // Get recent transactions for this wallet
                    const transactions = await this.suiWalletService.getRecentTransactions(wallet.address);

                    for (const tx of transactions) {
                        // Check if this transaction is already recorded
                        const existingTx = await prisma.receivedTransaction.findFirst({
                            where: {
                                transactionHash: tx.digest,
                                walletId: wallet.id
                            }
                        });

                        if (!existingTx) {
                            Logger.info('TransactionMonitor', 'Found new transaction', {
                                walletId: wallet.id,
                                txHash: tx.digest
                            });

                            // Ensure we have valid data
                            if (!tx.sender || !tx.digest) {
                                Logger.warn('TransactionMonitor', 'Skipping transaction with missing data', {
                                    walletId: wallet.id,
                                    txHash: tx.digest,
                                    hasSender: !!tx.sender
                                });
                                continue;
                            }

                            // Format the transaction data
                            const transactionData = {
                                fromAddress: tx.sender,
                                amount: parseFloat(tx.amount || '0'),
                                tokenName: 'SUI',
                                transactionHash: tx.digest,
                                date: new Date(tx.timestamp).toISOString(),
                                status: 'Confirmed' as const
                            };

                            Logger.info('TransactionMonitor', 'Adding transaction to Notion', transactionData);

                            // Add to Notion
                            const notionPage = await notionService.addReceivedTransaction(transactionData);

                            // Create received transaction in database
                            await prisma.receivedTransaction.create({
                                data: {
                                    walletId: wallet.id,
                                    fromAddress: tx.sender,
                                    amount: tx.amount || '0',
                                    tokenName: 'SUI',
                                    transactionHash: tx.digest,
                                    date: new Date(tx.timestamp),
                                    status: 'CONFIRMED',
                                    notionPageId: notionPage.id
                                }
                            });

                            Logger.info('TransactionMonitor', 'Recorded new transaction', {
                                walletId: wallet.id,
                                txHash: tx.digest
                            });
                        }
                    }
                } catch (error) {
                    Logger.error('TransactionMonitor', 'Error processing wallet transactions', {
                        error,
                        walletId: wallet.id
                    });
                    // Continue with next wallet even if one fails
                    continue;
                }
            }
        } catch (error) {
            Logger.error('TransactionMonitor', 'Error checking transactions', { error });
        }
    }
}

// Create and export a singleton instance
export const transactionMonitor = new TransactionMonitor(); 