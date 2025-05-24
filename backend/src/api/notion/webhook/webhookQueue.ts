import QueueManager from "@/common/utils/Queue";
import { Job } from 'bullmq';
import { env } from "@/common/utils/envConfig";
import { Logger } from '@/common/utils/logger';
import { SuiWalletService } from '@/common/walletService/suiWallet';
import { prisma } from '@/database';
import { Client } from '@notionhq/client';

Logger.info('AnalyzeQueue', 'Initializing queue with Redis host and port', { host: env.REDIS_HOST, port: env.REDIS_PORT });
export const analyzeQueue = new QueueManager("analyzeQueue", 
    {
        host: env.REDIS_HOST,
        port: env.REDIS_PORT,
        password: env.REDIS_PASSWORD,
        defaultJobOptions: {
            attempts: 6,  // Number of retry attempts
            backoff: {
                type: 'exponential',
                delay: 10000  // Initial delay in ms
            }
        }
    }
);

const analyzeQueueJobProcessor = async (job: Job) => {
    try {
        Logger.info('AnalyzeQueue', `Processing job`, { jobId: job.id, data: job.data });
        const data = job.data;

        if (data.type === 'SCHEDULED_TRANSACTION') {
            Logger.info('AnalyzeQueue', 'Processing scheduled transaction', { data: data.data });
            await processScheduledTransaction(data.data);
        }

        Logger.info('AnalyzeQueue', `Successfully processed job`, { jobId: job.id });
        return { success: true };
    } catch (error) {
        Logger.error('AnalyzeQueue', `Error processing job`, { jobId: job.id, error });
        throw error;
    }
};

async function processScheduledTransaction(data: {
    pageId: string;
    walletId: string;
    toAddress: string;
    amount: string;
    scheduleDate: string;
    transactionName: string;
}) {
    try {
        Logger.info('AnalyzeQueue', 'Starting scheduled transaction processing', {
            pageId: data.pageId,
            walletId: data.walletId,
            transactionName: data.transactionName
        });

        // Validate required data
        const missingFields = [];
        if (!data.pageId) missingFields.push('pageId');
        if (!data.walletId) missingFields.push('walletId');
        if (!data.toAddress) missingFields.push('toAddress');
        if (!data.amount) missingFields.push('amount');
        if (!data.scheduleDate) missingFields.push('scheduleDate');
        if (!data.transactionName) missingFields.push('transactionName');

        if (missingFields.length > 0) {
            Logger.error('AnalyzeQueue', 'Missing required fields', { missingFields });
            throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
        }

        // Get the wallet and its keypair
        const wallet = await prisma.wallet.findUnique({
            where: { id: data.walletId },
            include: { keyPair: true }
        });

        if (!wallet) {
            Logger.error('AnalyzeQueue', 'Wallet not found', { walletId: data.walletId });
            throw new Error(`Wallet not found with ID: ${data.walletId}`);
        }

        if (!wallet.keyPair) {
            Logger.error('AnalyzeQueue', 'Wallet keypair not found', { walletId: data.walletId });
            throw new Error(`Wallet keypair not found for wallet: ${data.walletId}`);
        }

        const suiWalletService = new SuiWalletService();
        
        // Execute the transaction using the stored keypair
        const result = await suiWalletService.sendTransaction(
            data.walletId,
            data.toAddress,
            data.amount
        );

        Logger.info('AnalyzeQueue', 'Transaction executed successfully', {
            transactionHash: result.transactionHash,
            walletId: data.walletId
        });

        // Update transaction status in database
        await prisma.transaction.create({
            data: {
                hash: result.transactionHash,
                from: wallet.address,
                to: data.toAddress,
                value: data.amount,
                status: 'SUCCESS',
                walletId: data.walletId,
                notionPageId: data.pageId
            }
        });

        // Update scheduled transaction status in Prisma
        await prisma.scheduledTransaction.update({
            where: { notionPageId: data.pageId },
            data: {
                operataStatus: 'COMPLETED'
            }
        });

        // Get the workspace to get the Notion token
        const workspace = await prisma.walletWorkspace.findUnique({
            where: { id: wallet.workspaceId }
        });

        if (!workspace) {
            throw new Error('Workspace not found');
        }

        // Update Notion page status
        const notionClient = new Client({ auth: workspace.notionToken });
        await notionClient.pages.update({
            page_id: data.pageId,
            properties: {
                'Operata Status': {
                    select: { name: 'Completed' }
                }
            }
        });

        Logger.info('AnalyzeQueue', 'Successfully processed scheduled transaction', {
            transactionName: data.transactionName,
            transactionHash: result.transactionHash
        });
    } catch (error) {
        Logger.error('AnalyzeQueue', 'Error processing scheduled transaction', { 
            error,
            pageId: data.pageId,
            walletId: data.walletId
        });

        try {
            // Update scheduled transaction status in Prisma
            if (data.pageId) {
                await prisma.scheduledTransaction.update({
                    where: { notionPageId: data.pageId },
                    data: {
                        operataStatus: 'FAILED'
                    }
                });

                // Update Notion page status to failed
                const wallet = await prisma.wallet.findUnique({
                    where: { id: data.walletId },
                    include: { workspace: true }
                });

                if (wallet?.workspace) {
                    const notionClient = new Client({ auth: wallet.workspace.notionToken });
                    await notionClient.pages.update({
                        page_id: data.pageId,
                        properties: {
                            'Operata Status': {
                                select: { name: 'Failed' }
                            }
                        }
                    });
                }
            }
        } catch (updateError) {
            Logger.error('AnalyzeQueue', 'Error updating transaction status after failure', { 
                error: updateError,
                pageId: data.pageId,
                walletId: data.walletId
            });
        }

        throw error;
    }
}

export const registerAnalyzeWorkers = async () => {
    Logger.info('AnalyzeQueue', 'Registering worker for analyzeQueue');
    await analyzeQueue.registerWorker(analyzeQueueJobProcessor, {
        concurrency: 5
    });
    Logger.info('AnalyzeQueue', 'Worker registration completed');
};

export const addScheduledTransactionToQueue = async (data: {
    pageId: string;
    walletId: string;
    toAddress: string;
    amount: string;
    scheduleDate: string;
    transactionName: string;
}) => {
    try {
        Logger.info('AnalyzeQueue', 'Adding scheduled transaction to queue', {
            pageId: data.pageId,
            walletId: data.walletId,
            transactionName: data.transactionName
        });

        // Calculate delay until scheduled time
        const scheduledTime = new Date(data.scheduleDate).getTime();
        const now = Date.now();
        const delay = Math.max(0, scheduledTime - now);

        // Add job to queue with delay
        await analyzeQueue.addToQueue({
            type: 'SCHEDULED_TRANSACTION',
            data
        }, {
            delay,
            attempts: 6,
            backoff: {
                type: 'exponential',
                delay: 10000
            }
        });

        Logger.info('AnalyzeQueue', 'Successfully added scheduled transaction to queue', {
            pageId: data.pageId,
            walletId: data.walletId,
            transactionName: data.transactionName,
            delay
        });
    } catch (error) {
        Logger.error('AnalyzeQueue', 'Error adding scheduled transaction to queue', {
            error,
            pageId: data.pageId,
            walletId: data.walletId
        });
        throw error;
    }
};



