import { Client } from '@notionhq/client';
import { PageObjectResponse, DatabaseObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import { prisma } from '@/database';
import { Logger } from '@/common/utils/logger';
import { analyzeQueue } from './webhookQueue';
import { SuiWalletService } from '@/common/walletService/suiWallet';
import { NotionService } from '@/common/notion';

interface WebhookEvent {
    id: string;
    timestamp: string;
    workspace_id: string;
    workspace_name: string;
    subscription_id: string;
    integration_id: string;
    authors: Array<{ id: string; type: string }>;
    accessible_by: Array<{ id: string; type: string }>;
    attempt_number: number;
    entity: {
        id: string;
        type: string;
    };
    type: string;
    data: {
        parent?: {
            id: string;
            type: string;
        };
        updated_blocks?: any[];
    };
}

export class NotionWebhookHandler {
    private notionClient: Client;
    private suiWalletService: SuiWalletService;
    private notionService: NotionService;

    constructor(notionToken: string) {
        this.notionClient = new Client({ auth: notionToken });
        this.suiWalletService = new SuiWalletService();
        this.notionService = new NotionService(notionToken);
    }

    async handleWebhook(event: WebhookEvent): Promise<void> {
        try {
            Logger.info('WebhookHandler', 'Processing webhook event', { 
                eventId: event.id,
                eventType: event.type,
                workspaceId: event.workspace_id,
                entityId: event.entity?.id
            });

            // Check if the change was made by a person (not a bot)
            const isBotChange = event.authors.some(author => author.type === 'bot');
            if (isBotChange) {
                Logger.info('WebhookHandler', 'Skipping bot change', { 
                    authors: event.authors,
                    eventId: event.id 
                });
                return;
            }

            // Handle different types of events
            switch (event.type) {
                case 'page.created':
                    Logger.info('WebhookHandler', 'Handling page creation', { pageId: event.entity?.id });
                    await this.handlePageCreation(event);
                    break;
                case 'page.content_updated':
                    Logger.info('WebhookHandler', 'Handling page update', { pageId: event.entity?.id });
                    await this.handlePageUpdate(event);
                    break;
                case 'page.properties_updated':
                    Logger.info('WebhookHandler', 'Handling page properties update', { pageId: event.entity?.id });
                    await this.handlePagePropertiesUpdate(event);
                    break;
                case 'database.updated':
                    Logger.info('WebhookHandler', 'Handling database update', { databaseId: event.entity?.id });
                    await this.handleDatabaseUpdate(event);
                    break;
                default:
                    Logger.info('WebhookHandler', 'Unhandled event type', { type: event.type });
            }
        } catch (error) {
            Logger.error('WebhookHandler', 'Error handling webhook', { 
                error,
                eventId: event.id,
                eventType: event.type
            });
            throw error;
        }
    }

    private async handlePageCreation(event: WebhookEvent): Promise<void> {
        if (!event.entity?.id) {
            Logger.warn('WebhookHandler', 'Missing entity ID in page creation event');
            return;
        }

        try {
            Logger.info('WebhookHandler', 'Retrieving page details', { pageId: event.entity.id });
            const page = await this.notionClient.pages.retrieve({ page_id: event.entity.id }) as PageObjectResponse;
            
            // Get the parent database ID if it exists
            const parentDatabaseId = page.parent?.type === 'database_id' ? page.parent.database_id : null;
            if (!parentDatabaseId) {
                Logger.info('WebhookHandler', 'Page has no parent database', { pageId: event.entity.id });
                return;
            }

            Logger.info('WebhookHandler', 'Retrieved page details', {
                pageId: event.entity.id,
                parentDatabaseId,
                pageType: page.object,
                pageProperties: Object.keys(page.properties)
            });

            // Check which database this page belongs to
            const scheduleTransactionsDbId = await this.notionService.getScheduleTransactionsDatabaseId();
            const transactionsDbId = await this.notionService.getTransactionsDatabaseId();
            const nftsDbId = await this.notionService.getNFTDatabaseId();
            const receivedTransactionsDbId = await this.notionService.getReceivedTransactionsDatabaseId();

            Logger.info('WebhookHandler', 'Checking database type', {
                pageId: event.entity.id,
                parentDatabaseId,
                scheduleTransactionsDbId,
                transactionsDbId,
                nftsDbId,
                receivedTransactionsDbId
            });

            if (parentDatabaseId === scheduleTransactionsDbId) {
                Logger.info('WebhookHandler', 'Processing new scheduled transaction', { pageId: event.entity.id });
                await this.processScheduledTransaction(page);
            } else if (parentDatabaseId === transactionsDbId) {
                Logger.info('WebhookHandler', 'Processing new transaction', { pageId: event.entity.id });
                await this.processTransactionCreation(page);
            } else if (parentDatabaseId === nftsDbId) {
                Logger.info('WebhookHandler', 'Processing new NFT', { pageId: event.entity.id });
                await this.processNFTCreation(page);
            } else if (parentDatabaseId === receivedTransactionsDbId) {
                Logger.info('WebhookHandler', 'Processing new received transaction', { pageId: event.entity.id });
                await this.processReceivedTransactionCreation(page);
            } else {
                Logger.info('WebhookHandler', 'Page belongs to unknown database', {
                    pageId: event.entity.id,
                    parentDatabaseId
                });
            }
        } catch (error) {
            Logger.error('WebhookHandler', 'Error handling page creation', { 
                error,
                pageId: event.entity.id 
            });
            throw error;
        }
    }

    private async handlePageUpdate(event: WebhookEvent): Promise<void> {
        if (!event.entity?.id) {
            Logger.warn('WebhookHandler', 'Missing entity ID in page update event');
            return;
        }

        try {
            Logger.info('WebhookHandler', 'Retrieving page details', { pageId: event.entity.id });
            // Get the page details
            const page = await this.notionClient.pages.retrieve({ page_id: event.entity.id }) as PageObjectResponse;
            
            // Get the parent database ID if it exists
            const parentDatabaseId = page.parent?.type === 'database_id' ? page.parent.database_id : null;
            if (!parentDatabaseId) {
                Logger.info('WebhookHandler', 'Page has no parent database', { pageId: event.entity.id });
                return;
            }

            Logger.info('WebhookHandler', 'Checking if page is in scheduled transactions database', { 
                pageId: event.entity.id,
                parentDatabaseId 
            });

            // Check if this is a scheduled transaction page
            const scheduleTransactionsDbId = await this.notionService.getScheduleTransactionsDatabaseId();
            if (parentDatabaseId === scheduleTransactionsDbId) {
                Logger.info('WebhookHandler', 'Processing scheduled transaction page', { pageId: event.entity.id });
                
                // Get the properties to check status
                const properties = page.properties;
                const adminStatus = properties['Admin Status']?.type === 'select'
                    ? properties['Admin Status'].select?.name
                    : undefined;

                // If admin has approved the transaction
                if (adminStatus === 'Approved') {
                    // Get transaction details
                    const toAddress = properties['To Address']?.type === 'rich_text'
                        ? properties['To Address'].rich_text[0]?.plain_text
                        : undefined;
                    
                    const amount = properties['Amount']?.type === 'number'
                        ? properties['Amount'].number
                        : undefined;
                    
                    const scheduleDate = properties['Schedule Date']?.type === 'date'
                        ? properties['Schedule Date'].date?.start
                        : undefined;
                    
                    const transactionName = properties['Transaction Name']?.type === 'title'
                        ? properties['Transaction Name'].title[0]?.plain_text
                        : undefined;

                    if (!toAddress || !amount || !scheduleDate || !transactionName) {
                        Logger.error('WebhookHandler', 'Missing required transaction fields', {
                            pageId: event.entity.id,
                            hasToAddress: !!toAddress,
                            hasAmount: !!amount,
                            hasScheduleDate: !!scheduleDate,
                            hasTransactionName: !!transactionName
                        });
                        return;
                    }

                    // Get the workspace and wallet
                    const workspace = await this.getWorkspaceFromPage(event.entity.id);
                    if (!workspace) {
                        Logger.error('WebhookHandler', 'Workspace not found for page', { pageId: event.entity.id });
                        return;
                    }

                    const wallet = await prisma.wallet.findFirst({
                        where: { workspaceId: workspace.id }
                    });

                    if (!wallet) {
                        Logger.error('WebhookHandler', 'Wallet not found for workspace', { 
                            pageId: event.entity.id,
                            workspaceId: workspace.id 
                        });
                        return;
                    }

                    // Calculate delay for scheduled transaction
                    const delay = this.calculateDelay(scheduleDate);
                    
                    // Queue the transaction
                    await analyzeQueue.addToQueue({
                        type: 'SCHEDULED_TRANSACTION',
                        data: {
                            pageId: event.entity.id,
                            walletId: wallet.id,
                            toAddress,
                            amount: amount.toString(),
                            scheduleDate,
                            transactionName
                        }
                    }, {
                        delay
                    });

                    // Update status to Processing
                    await Promise.all([
                        prisma.scheduledTransaction.update({
                            where: { notionPageId: event.entity.id },
                            data: { operataStatus: 'PROCESSING' }
                        }),
                        this.notionClient.pages.update({
                            page_id: event.entity.id,
                            properties: {
                                'Operata Status': {
                                    select: { name: 'Processing' }
                                }
                            }
                        })
                    ]);

                    Logger.info('WebhookHandler', 'Successfully queued scheduled transaction', {
                        pageId: event.entity.id,
                        walletId: wallet.id,
                        delay
                    });
                }
            }
        } catch (error) {
            Logger.error('WebhookHandler', 'Error handling page update', { 
                error,
                pageId: event.entity.id 
            });
            throw error;
        }
    }

    private async handleDatabaseUpdate(event: WebhookEvent): Promise<void> {
        if (!event.entity?.id) {
            Logger.warn('WebhookHandler', 'Missing entity ID in database update event');
            return;
        }

        try {
            Logger.info('WebhookHandler', 'Retrieving database details', { databaseId: event.entity.id });
            // Get the database details
            const database = await this.notionClient.databases.retrieve({ database_id: event.entity.id }) as DatabaseObjectResponse;
            
            // Check if this is a transactions database
            const transactionsDbId = await this.notionService.getTransactionsDatabaseId();
            if (event.entity.id === transactionsDbId) {
                Logger.info('WebhookHandler', 'Processing transaction database update', { databaseId: event.entity.id });
                await this.processTransactionDatabaseUpdate(database);
            }
        } catch (error) {
            Logger.error('WebhookHandler', 'Error handling database update', { 
                error,
                databaseId: event.entity.id 
            });
            throw error;
        }
    }

    private async handlePagePropertiesUpdate(event: WebhookEvent): Promise<void> {
        if (!event.entity?.id) {
            Logger.warn('WebhookHandler', 'Missing entity ID in page properties update event');
            return;
        }

        try {
            Logger.info('WebhookHandler', 'Retrieving page details', { pageId: event.entity.id });
            const page = await this.notionClient.pages.retrieve({ page_id: event.entity.id }) as PageObjectResponse;
            console.log(page);

            
            // Get the parent database ID if it exists
            const parentDatabaseId = page.parent?.type === 'database_id' ? page.parent.database_id : null;
            if (!parentDatabaseId) {
                Logger.info('WebhookHandler', 'Page has no parent database', { pageId: event.entity.id });
                return;
            }

            // Check if this is a scheduled transaction page
            const scheduleTransactionsDbId = await this.notionService.getScheduleTransactionsDatabaseId();
            console.log(scheduleTransactionsDbId)
            if (parentDatabaseId === scheduleTransactionsDbId) {
                Logger.info('WebhookHandler', 'Processing scheduled transaction properties update', { pageId: event.entity.id });
                await this.syncScheduledTransactionStatus(page);
            }else{
                Logger.info('WebhookHandler', 'No databse found skipping', { parentDatabaseId, scheduleTransactionsDbId });
            }
        } catch (error) {
            Logger.error('WebhookHandler', 'Error handling page properties update', { 
                error,
                pageId: event.entity.id 
            });
            throw error;
        }
    }

    private async syncScheduledTransactionStatus(page: PageObjectResponse): Promise<void> {
        try {
            const properties = page.properties;
            
            // Get the scheduled transaction from Prisma
            const scheduledTx = await prisma.scheduledTransaction.findUnique({
                where: { notionPageId: page.id }
            });

            if (!scheduledTx) {
                Logger.warn('WebhookHandler', 'Scheduled transaction not found in Prisma', { pageId: page.id });
                return;
            }

            const adminStatus = properties['Admin Status']?.type === 'select'
                ? properties['Admin Status'].select?.name
                : undefined;
            
            const operataStatus = properties['Operata Status']?.type === 'select'
                ? properties['Operata Status'].select?.name
                : undefined;

            // If the transaction is completed or failed, don't allow status changes
            if (scheduledTx.operataStatus === 'COMPLETED' || scheduledTx.operataStatus === 'FAILED') {
                // Update Notion to reflect the correct status
                await this.notionClient.pages.update({
                    page_id: page.id,
                    properties: {
                        'Admin Status': {
                            select: { name: scheduledTx.adminStatus }
                        },
                        'Operata Status': {
                            select: { name: scheduledTx.operataStatus }
                        }
                    }
                });
                return;
            }

            // Update Prisma if statuses have changed
            const updates: any = {};
            if (adminStatus && adminStatus !== scheduledTx.adminStatus) {
                updates.adminStatus = adminStatus;
            }
            if (operataStatus && operataStatus !== scheduledTx.operataStatus) {
                updates.operataStatus = operataStatus;
            }

            if (Object.keys(updates).length > 0) {
                await prisma.scheduledTransaction.update({
                    where: { id: scheduledTx.id },
                    data: updates
                });
            }
        } catch (error) {
            Logger.error('WebhookHandler', 'Error syncing scheduled transaction status', { 
                error,
                pageId: page.id 
            });
            throw error;
        }
    }

    private async processScheduledTransaction(page: PageObjectResponse): Promise<void> {
        try {
            Logger.info('WebhookHandler', 'Processing scheduled transaction', { pageId: page.id });
            const properties = page.properties;
            
            // Extract transaction details with proper type checking
            const transactionName = properties['Transaction Name']?.type === 'title' 
                ? properties['Transaction Name'].title[0]?.plain_text
                : undefined;
            
            const toAddress = properties['To Address']?.type === 'rich_text'
                ? (properties['To Address'].rich_text[0]?.plain_text)
                : undefined;
            
            const amount = properties['Amount']?.type === 'number'
                ? properties['Amount'].number
                : undefined;
            
            const scheduleDate = properties['Schedule Date']?.type === 'date'
                ? properties['Schedule Date'].date?.start
                : undefined;
            
            const adminStatus = properties['Admin Status']?.type === 'select'
                ? properties['Admin Status'].select?.name
                : undefined;
            
            const operataStatus = properties['Operata Status']?.type === 'select'
                ? properties['Operata Status'].select?.name
                : undefined;

            // Validate required fields
            if (!transactionName || !toAddress || !amount || !scheduleDate) {
                Logger.error('WebhookHandler', 'Missing required transaction fields', {
                    pageId: page.id,
                    hasTransactionName: !!transactionName,
                    hasToAddress: !!toAddress,
                    hasAmount: !!amount,
                    hasScheduleDate: !!scheduleDate
                });
                throw new Error('Missing required transaction fields');
            }

            // Get the parent database ID
            const parentDatabaseId = page.parent?.type === 'database_id' ? page.parent.database_id : null;
            if (!parentDatabaseId) {
                throw new Error('Page is not part of a database');
            }

            // Find the workspace and wallet through the database ID
            const wallet = await prisma.wallet.findFirst({
                where: { scheduleTransactionsDatabaseId: parentDatabaseId },
                include: { workspace: true }
            });

            if (!wallet) {
                throw new Error('No wallet found for this scheduled transaction database');
            }

            const workspace = wallet.workspace;
            if (!workspace) {
                throw new Error('No workspace found for wallet');
            }

            Logger.info('WebhookHandler', 'Found workspace and wallet', {
                pageId: page.id,
                workspaceId: workspace.id,
                walletId: wallet.id
            });

            // Create or update the scheduled transaction in Prisma
            const scheduledTx = await prisma.scheduledTransaction.upsert({
                where: { notionPageId: page.id },
                create: {
                    notionPageId: page.id,
                    walletId: wallet.id,
                    transactionName,
                    toAddress,
                    amount: amount.toString(),
                    scheduleDate: new Date(scheduleDate),
                    adminStatus: adminStatus || 'SCHEDULED',
                    operataStatus: operataStatus || 'PENDING'
                },
                update: {
                    transactionName,
                    toAddress,
                    amount: amount.toString(),
                    scheduleDate: new Date(scheduleDate),
                    adminStatus: adminStatus || 'SCHEDULED',
                    operataStatus: operataStatus || 'PENDING'
                }
            });

            // Only process if admin has approved
            if (adminStatus === 'Approved') {
                const delay = this.calculateDelay(scheduleDate);
                
                // Queue the transaction
                await analyzeQueue.addToQueue({
                    type: 'SCHEDULED_TRANSACTION',
                    data: {
                        pageId: page.id,
                        walletId: wallet.id,
                        toAddress,
                        amount: amount.toString(),
                        scheduleDate,
                        transactionName
                    }
                }, {
                    delay
                });

                // Update status to Processing
                await Promise.all([
                    prisma.scheduledTransaction.update({
                        where: { id: scheduledTx.id },
                        data: { operataStatus: 'PROCESSING' }
                    }),
                    this.notionClient.pages.update({
                        page_id: page.id,
                        properties: {
                            'Operata Status': {
                                select: { name: 'Processing' }
                            }
                        }
                    })
                ]);
            }
        } catch (error) {
            Logger.error('WebhookHandler', 'Error processing scheduled transaction', { 
                error,
                pageId: page.id 
            });
            throw error;
        }
    }

    private async processTransactionDatabaseUpdate(database: DatabaseObjectResponse): Promise<void> {
        try {
            Logger.info('WebhookHandler', 'Processing transaction database update', { databaseId: database.id });
            
            // Get recent transactions
            const response = await this.notionClient.databases.query({
                database_id: database.id,
                sorts: [{ property: 'Date', direction: 'descending' }],
                page_size: 10
            });

            Logger.info('WebhookHandler', 'Retrieved recent transactions', { 
                databaseId: database.id,
                transactionCount: response.results.length 
            });

            // Process each transaction
            for (const page of response.results) {
                if (page.object === 'page' && 'parent' in page && page.parent?.type === 'database_id') {
                    const scheduleTransactionsDbId = await this.notionService.getScheduleTransactionsDatabaseId();
                    if (page.parent.database_id === scheduleTransactionsDbId) {
                        Logger.info('WebhookHandler', 'Processing scheduled transaction from database update', { 
                            pageId: page.id,
                            databaseId: database.id 
                        });
                        await this.processScheduledTransaction(page as PageObjectResponse);
                    }
                }
            }
        } catch (error) {
            Logger.error('WebhookHandler', 'Error processing transaction database update', { 
                error,
                databaseId: database.id 
            });
            throw error;
        }
    }

    private async getWorkspaceFromPage(pageId: string) {
        try {
            Logger.info('WebhookHandler', 'Searching for workspace from page', { pageId });
            // Search for the workspace that owns this page
            const workspace = await prisma.walletWorkspace.findFirst({
                where: {
                    wallets: {
                        some: {
                            transactions: {
                                some: {
                                    notionPageId: pageId
                                }
                            }
                        }
                    }
                }
            });

            if (workspace) {
                Logger.info('WebhookHandler', 'Found workspace for page', { 
                    pageId,
                    workspaceId: workspace.id 
                });
            } else {
                Logger.warn('WebhookHandler', 'No workspace found for page', { pageId });
            }

            return workspace;
        } catch (error) {
            Logger.error('WebhookHandler', 'Error getting workspace from page', { 
                error,
                pageId 
            });
            throw error;
        }
    }

    private calculateDelay(scheduleDate: string): number {
        const scheduledTime = new Date(scheduleDate).getTime();
        const now = Date.now();
        const delay = Math.max(0, scheduledTime - now);
        Logger.info('WebhookHandler', 'Calculated delay for scheduled transaction', {
            scheduleDate,
            delay,
            scheduledTime,
            now
        });
        return delay;
    }

    private async processTransactionCreation(page: PageObjectResponse): Promise<void> {
        try {
            Logger.info('WebhookHandler', 'Starting transaction creation process', { pageId: page.id });
            const properties = page.properties;
            
            // Extract transaction details
            const description = properties['Description']?.type === 'title' 
                ? properties['Description'].title[0]?.plain_text
                : undefined;
            
            const amount = properties['Amount']?.type === 'number'
                ? properties['Amount'].number
                : undefined;
            
            const from = properties['From']?.type === 'rich_text'
                ? properties['From'].rich_text[0]?.plain_text
                : undefined;
            
            const to = properties['To']?.type === 'rich_text'
                ? properties['To'].rich_text[0]?.plain_text
                : undefined;
            
            const status = properties['Status']?.type === 'select'
                ? properties['Status'].select?.name
                : undefined;
            
            const date = properties['Date']?.type === 'date'
                ? properties['Date'].date?.start
                : undefined;

            Logger.info('WebhookHandler', 'Extracted transaction details', {
                pageId: page.id,
                hasDescription: !!description,
                hasAmount: !!amount,
                hasFrom: !!from,
                hasTo: !!to,
                hasStatus: !!status,
                hasDate: !!date
            });

            // Validate required fields
            if (!description || !amount || !from || !to || !date) {
                Logger.error('WebhookHandler', 'Missing required transaction fields', {
                    pageId: page.id,
                    hasDescription: !!description,
                    hasAmount: !!amount,
                    hasFrom: !!from,
                    hasTo: !!to,
                    hasDate: !!date
                });
                throw new Error('Missing required transaction fields');
            }

            // Get the workspace and wallet
            Logger.info('WebhookHandler', 'Looking up workspace for page', { pageId: page.id });
            const workspace = await this.getWorkspaceFromPage(page.id);
            if (!workspace) {
                Logger.error('WebhookHandler', 'Workspace not found for page', { pageId: page.id });
                throw new Error('Workspace not found for page');
            }

            Logger.info('WebhookHandler', 'Looking up wallet for workspace', {
                pageId: page.id,
                workspaceId: workspace.id
            });
            const wallet = await prisma.wallet.findFirst({
                where: { workspaceId: workspace.id }
            });

            if (!wallet) {
                Logger.error('WebhookHandler', 'Wallet not found for workspace', {
                    pageId: page.id,
                    workspaceId: workspace.id
                });
                throw new Error('Wallet not found for workspace');
            }

            // Create transaction in Prisma
            Logger.info('WebhookHandler', 'Creating transaction in Prisma', {
                pageId: page.id,
                walletId: wallet.id
            });
            await prisma.transaction.create({
                data: {
                    hash: `notion-${page.id}`, // Temporary hash for Notion-created transactions
                    from,
                    to,
                    value: amount.toString(),
                    status: status || 'PENDING',
                    walletId: wallet.id,
                    notionPageId: page.id
                }
            });

            Logger.info('WebhookHandler', 'Successfully created transaction', {
                pageId: page.id,
                walletId: wallet.id
            });
        } catch (error) {
            Logger.error('WebhookHandler', 'Error processing transaction creation', { 
                error,
                pageId: page.id 
            });
            throw error;
        }
    }

    private async processNFTCreation(page: PageObjectResponse): Promise<void> {
        try {
            Logger.info('WebhookHandler', 'Starting NFT creation process', { pageId: page.id });
            const properties = page.properties;
            
            // Extract NFT details
            const name = properties['Name']?.type === 'title' 
                ? properties['Name'].title[0]?.plain_text
                : undefined;
            
            const tokenId = properties['Token ID']?.type === 'number'
                ? properties['Token ID'].number
                : undefined;
            
            const contractAddress = properties['Contract Address']?.type === 'rich_text'
                ? properties['Contract Address'].rich_text[0]?.plain_text
                : undefined;

            const description = properties['Description']?.type === 'rich_text'
                ? properties['Description'].rich_text[0]?.plain_text
                : undefined;

            const imageUrl = properties['Image URL']?.type === 'url'
                ? properties['Image URL'].url
                : undefined;

            const receiveDate = properties['Receive Date']?.type === 'date'
                ? properties['Receive Date'].date?.start
                : undefined;

            const transactionHash = properties['Transaction Hash']?.type === 'rich_text'
                ? properties['Transaction Hash'].rich_text[0]?.plain_text
                : undefined;

            Logger.info('WebhookHandler', 'Extracted NFT details', {
                pageId: page.id,
                hasName: !!name,
                hasTokenId: !!tokenId,
                hasContractAddress: !!contractAddress,
                hasDescription: !!description,
                hasImageUrl: !!imageUrl,
                hasReceiveDate: !!receiveDate,
                hasTransactionHash: !!transactionHash
            });

            // Validate required fields
            if (!name || !tokenId || !contractAddress) {
                Logger.error('WebhookHandler', 'Missing required NFT fields', {
                    pageId: page.id,
                    hasName: !!name,
                    hasTokenId: !!tokenId,
                    hasContractAddress: !!contractAddress
                });
                throw new Error('Missing required NFT fields');
            }

            // Get the workspace and wallet
            Logger.info('WebhookHandler', 'Looking up workspace for page', { pageId: page.id });
            const workspace = await this.getWorkspaceFromPage(page.id);
            if (!workspace) {
                Logger.error('WebhookHandler', 'Workspace not found for page', { pageId: page.id });
                throw new Error('Workspace not found for page');
            }

            Logger.info('WebhookHandler', 'Looking up wallet for workspace', {
                pageId: page.id,
                workspaceId: workspace.id
            });
            const wallet = await prisma.wallet.findFirst({
                where: { workspaceId: workspace.id }
            });

            if (!wallet) {
                Logger.error('WebhookHandler', 'Wallet not found for workspace', {
                    pageId: page.id,
                    workspaceId: workspace.id
                });
                throw new Error('Wallet not found for workspace');
            }

            // Create NFT in Prisma
            Logger.info('WebhookHandler', 'Creating NFT in Prisma', {
                pageId: page.id,
                walletId: wallet.id
            });
            await prisma.nFT.create({
                data: {
                    name,
                    tokenId: tokenId.toString(),
                    contractAddress,
                    description,
                    imageUrl,
                    receiveDate: receiveDate ? new Date(receiveDate) : undefined,
                    transactionHash,
                    walletId: wallet.id,
                    notionPageId: page.id
                }
            });

            Logger.info('WebhookHandler', 'Successfully created NFT', {
                pageId: page.id,
                walletId: wallet.id
            });
        } catch (error) {
            Logger.error('WebhookHandler', 'Error processing NFT creation', { 
                error,
                pageId: page.id 
            });
            throw error;
        }
    }

    private async processReceivedTransactionCreation(page: PageObjectResponse): Promise<void> {
        try {
            Logger.info('WebhookHandler', 'Starting received transaction creation process', { pageId: page.id });
            const properties = page.properties;
            
            // Extract received transaction details
            const fromAddress = properties['From Address']?.type === 'title' 
                ? properties['From Address'].title[0]?.plain_text
                : undefined;
            
            const amount = properties['Amount']?.type === 'number'
                ? properties['Amount'].number
                : undefined;
            
            const tokenName = properties['Token Name']?.type === 'rich_text'
                ? properties['Token Name'].rich_text[0]?.plain_text
                : undefined;
            
            const transactionHash = properties['Transaction Hash']?.type === 'rich_text'
                ? properties['Transaction Hash'].rich_text[0]?.plain_text
                : undefined;
            
            const date = properties['Date']?.type === 'date'
                ? properties['Date'].date?.start
                : undefined;
            
            const status = properties['Status']?.type === 'select'
                ? properties['Status'].select?.name
                : undefined;

            const notes = properties['Notes']?.type === 'rich_text'
                ? properties['Notes'].rich_text[0]?.plain_text
                : undefined;

            Logger.info('WebhookHandler', 'Extracted received transaction details', {
                pageId: page.id,
                hasFromAddress: !!fromAddress,
                hasAmount: !!amount,
                hasTokenName: !!tokenName,
                hasTransactionHash: !!transactionHash,
                hasDate: !!date,
                hasStatus: !!status,
                hasNotes: !!notes
            });

            // Validate required fields
            if (!fromAddress || !amount || !tokenName || !transactionHash || !date) {
                Logger.error('WebhookHandler', 'Missing required received transaction fields', {
                    pageId: page.id,
                    hasFromAddress: !!fromAddress,
                    hasAmount: !!amount,
                    hasTokenName: !!tokenName,
                    hasTransactionHash: !!transactionHash,
                    hasDate: !!date
                });
                throw new Error('Missing required received transaction fields');
            }

            // Get the workspace and wallet
            Logger.info('WebhookHandler', 'Looking up workspace for page', { pageId: page.id });
            const workspace = await this.getWorkspaceFromPage(page.id);
            if (!workspace) {
                Logger.error('WebhookHandler', 'Workspace not found for page', { pageId: page.id });
                throw new Error('Workspace not found for page');
            }

            Logger.info('WebhookHandler', 'Looking up wallet for workspace', {
                pageId: page.id,
                workspaceId: workspace.id
            });
            const wallet = await prisma.wallet.findFirst({
                where: { workspaceId: workspace.id }
            });

            if (!wallet) {
                Logger.error('WebhookHandler', 'Wallet not found for workspace', {
                    pageId: page.id,
                    workspaceId: workspace.id
                });
                throw new Error('Wallet not found for workspace');
            }

            // Create received transaction in Prisma
            Logger.info('WebhookHandler', 'Creating received transaction in Prisma', {
                pageId: page.id,
                walletId: wallet.id
            });
            await prisma.receivedTransaction.create({
                data: {
                    fromAddress,
                    amount: amount.toString(),
                    tokenName,
                    transactionHash,
                    date: new Date(date),
                    status: status || 'PENDING',
                    notes,
                    walletId: wallet.id,
                    notionPageId: page.id
                }
            });

            Logger.info('WebhookHandler', 'Successfully created received transaction', {
                pageId: page.id,
                walletId: wallet.id
            });
        } catch (error) {
            Logger.error('WebhookHandler', 'Error processing received transaction creation', { 
                error,
                pageId: page.id 
            });
            throw error;
        }
    }
} 