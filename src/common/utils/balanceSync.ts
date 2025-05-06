import { NotionService } from '../notion';
import { Logger } from './logger';
import { prisma } from '@/database';

export class BalanceSyncScheduler {
    private interval: NodeJS.Timeout | null = null;
    private isRunning: boolean = false;

    constructor() {
        Logger.info('BalanceSyncScheduler', 'Initialized balance sync scheduler');
    }

    async start(): Promise<void> {
        if (this.isRunning) {
            Logger.warn('BalanceSyncScheduler', 'Scheduler is already running');
            return;
        }

        Logger.info('BalanceSyncScheduler', 'Starting balance sync scheduler');
        this.isRunning = true;

        // Run immediately on start
        await this.syncBalances();

        // Then run every 30 seconds
        this.interval = setInterval(async () => {
            await this.syncBalances();
        }, 30000); // 30 seconds
    }

    async stop(): Promise<void> {
        if (!this.isRunning) {
            Logger.warn('BalanceSyncScheduler', 'Scheduler is not running');
            return;
        }

        Logger.info('BalanceSyncScheduler', 'Stopping balance sync scheduler');
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        this.isRunning = false;
    }

    private async syncBalances(): Promise<void> {
        try {
            Logger.info('BalanceSyncScheduler', 'Starting balance sync cycle');

            // Get all wallets
            const wallets = await prisma.wallet.findMany({
                include: {
                    workspace: true
                }
            });

            Logger.info('BalanceSyncScheduler', `Found ${wallets.length} wallets to sync`);

            for (const wallet of wallets) {
                try {
                    if (!wallet.workspace?.notionToken) {
                        Logger.warn('BalanceSyncScheduler', 'Wallet has no notion token', { walletId: wallet.id });
                        continue;
                    }

                    const notionService = new NotionService(wallet.workspace.notionToken, wallet.workspace.workspaceId);
                    await notionService.syncWalletBalances();

                    Logger.info('BalanceSyncScheduler', 'Successfully synced wallet balance', {
                        walletId: wallet.id,
                        workspaceId: wallet.workspaceId
                    });
                } catch (error) {
                    Logger.error('BalanceSyncScheduler', 'Error syncing individual wallet', {
                        error,
                        walletId: wallet.id
                    });
                    // Continue with next wallet even if one fails
                    continue;
                }
            }

            Logger.info('BalanceSyncScheduler', 'Completed balance sync cycle');
        } catch (error) {
            Logger.error('BalanceSyncScheduler', 'Error in balance sync cycle', { error });
        }
    }
}

// Create and export a singleton instance
export const balanceSyncScheduler = new BalanceSyncScheduler(); 