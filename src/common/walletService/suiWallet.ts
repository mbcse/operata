import { Ed25519Keypair } from '@mysten/sui.js/keypairs/ed25519';
import { fromB64 } from '@mysten/sui.js/utils';
import { TransactionBlock } from '@mysten/sui.js/transactions';
import { SuiClient, SuiEvent } from '@mysten/sui.js/client';
import { prisma } from '@/database';
import { env } from '../utils/envConfig';
import { Logger } from '../utils/logger';
import { encrypt, decrypt } from '../utils/encryption';

export class SuiWalletService {
    private client: SuiClient;

    constructor() {
        this.client = new SuiClient({ url: env.SUI_TESTNET_RPC_URL });
    }

    async createWallet(workspaceId: string): Promise<{ walletId: string; address: string }> {
        try {
            // Generate new keypair
            const keypair = new Ed25519Keypair();
            const publicKey = keypair.getPublicKey().toBase64();
            const privateKey = keypair.export().privateKey;
            const address = keypair.getPublicKey().toSuiAddress();

            // Encrypt private key
            const encryptedPrivateKey = await encrypt(privateKey);

            // Create wallet in database
            const wallet = await prisma.wallet.create({
                data: {
                    id: crypto.randomUUID(),
                    address: address,
                    chainType: 'sui',
                    workspaceId,
                    keyPair: {
                        create: {
                            publicKey,
                            privateKey: encryptedPrivateKey
                        }
                    }
                }
            });

            return {
                walletId: wallet.id,
                address: wallet.address
            };
        } catch (error) {
            Logger.error('SuiWalletService', 'Error creating wallet', { error });
            throw new Error('Failed to create wallet');
        }
    }

    async getWalletKeyPair(walletId: string): Promise<Ed25519Keypair> {
        try {
            const wallet = await prisma.wallet.findUnique({
                where: { id: walletId },
                include: { keyPair: true }
            });

            if (!wallet) {
                Logger.error('SuiWalletService', 'Wallet not found', { walletId });
                throw new Error(`Wallet not found with ID: ${walletId}`);
            }

            if (!wallet.keyPair) {
                Logger.error('SuiWalletService', 'Key pair not found for wallet', { walletId });
                throw new Error(`Key pair not found for wallet: ${walletId}`);
            }

            try {
                // Decrypt private key
                const decryptedPrivateKey = await decrypt(wallet.keyPair.privateKey);
                
                // Create keypair directly from the decrypted buffer
                return Ed25519Keypair.fromSecretKey(decryptedPrivateKey);
            } catch (decryptError) {
                Logger.error('SuiWalletService', 'Error decrypting private key', { 
                    walletId,
                    error: decryptError,
                    errorMessage: decryptError instanceof Error ? decryptError.message : String(decryptError)
                });
                throw new Error(`Failed to decrypt private key: ${decryptError instanceof Error ? decryptError.message : String(decryptError)}`);
            }
        } catch (error) {
            Logger.error('SuiWalletService', 'Error getting wallet key pair', { 
                walletId,
                error,
                errorMessage: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    async getBalance(walletId: string): Promise<string> {
        try {
            const wallet = await prisma.wallet.findUnique({
                where: { id: walletId }
            });

            if (!wallet) {
                throw new Error('Wallet not found');
            }

            const balance = await this.client.getBalance({
                owner: wallet.address,
                coinType: '0x2::sui::SUI'
            });

            // Update wallet balance in database
            await prisma.wallet.update({
                where: { id: walletId },
                data: {
                    balance: balance.totalBalance,
                    lastSyncAt: new Date()
                }
            });

            return balance.totalBalance;
        } catch (error) {
            Logger.error('SuiWalletService', 'Error getting balance', { error });
            throw new Error('Failed to get balance');
        }
    }

    async sendTransaction(walletId: string, toAddress: string, amount: string): Promise<{ transactionHash: string }> {
        try {
            const keypair = await this.getWalletKeyPair(walletId);
            const wallet = await prisma.wallet.findUnique({
                where: { id: walletId }
            });

            if (!wallet) {
                throw new Error('Wallet not found');
            }

            // Create transaction
            const tx = new TransactionBlock();
            const [coin] = tx.splitCoins(tx.gas, [tx.pure(amount)]);
            tx.transferObjects([coin], tx.pure(toAddress));

            // Sign and execute transaction
            const result = await this.client.signAndExecuteTransactionBlock({
                signer: keypair,
                transactionBlock: tx,
                options: {
                    showEffects: true,
                    showEvents: true
                }
            });

            // Store transaction in database
            await prisma.transaction.create({
                data: {
                    hash: result.digest,
                    from: wallet.address,
                    to: toAddress,
                    value: amount,
                    status: 'PENDING',
                    walletId
                }
            });

            return { transactionHash: result.digest };
        } catch (error) {
            Logger.error('SuiWalletService', 'Error sending transaction', { error });
            throw new Error('Failed to send transaction');
        }
    }

    async listenToTransactions(walletId: string, callback: (transaction: SuiEvent) => void): Promise<() => void> {
        try {
            const wallet = await prisma.wallet.findUnique({
                where: { id: walletId }
            });

            if (!wallet) {
                throw new Error('Wallet not found');
            }

            // Subscribe to transaction events
            const subscription = await this.client.subscribeEvent({
                filter: {
                    MoveModule: {
                        package: '0x2',
                        module: 'transfer'
                    }
                },
                onMessage: async (event: SuiEvent) => {
                    const parsedEvent = event.parsedJson as { sender?: string; recipient?: string };
                    if (parsedEvent.sender === wallet.address || parsedEvent.recipient === wallet.address) {
                        callback(event);
                    }
                }
            });

            return subscription;
        } catch (error) {
            Logger.error('SuiWalletService', 'Error listening to transactions', { error });
            throw new Error('Failed to listen to transactions');
        }
    }

    async getRecentTransactions(address: string): Promise<Array<{
        digest: string;
        sender: string;
        amount: string;
        timestamp: number;
    }>> {
        try {
            // Fetch transactions where address is sender
            const fromTxs = await this.client.queryTransactionBlocks({
                filter: { FromAddress: address },
                options: { showInput: true, showEffects: true, showEvents: true },
                limit: 20
            });
            // Fetch transactions where address is recipient
            const toTxs = await this.client.queryTransactionBlocks({
                filter: { ToAddress: address },
                options: { showInput: true, showEffects: true, showEvents: true },
                limit: 20
            });
            // Merge and sort by timestamp descending
            const allTxs = [...fromTxs.data, ...toTxs.data]
                .filter((tx): tx is typeof tx & { digest: string; timestampMs?: string | null; effects?: any; transaction?: any } => !!tx && typeof tx.digest === 'string')
                .sort((a, b) => Number(a.timestampMs ?? 0) < Number(b.timestampMs ?? 0) ? 1 : -1);

            return allTxs.map(tx => {
                const effects = tx.effects as any;
                let sender = tx.transaction?.data?.sender || '';
                let amount = '0';
                // Try to extract amount from balanceChanges if available
                if (effects?.balanceChanges && Array.isArray(effects.balanceChanges)) {
                    const change = effects.balanceChanges.find((c: any) => c.owner?.AddressOwner === address);
                    if (change) {
                        amount = change.amount || '0';
                    }
                }
                return {
                    digest: tx.digest,
                    sender,
                    amount,
                    timestamp: tx.timestampMs ? Number(tx.timestampMs) : Date.now()
                };
            });
        } catch (error) {
            Logger.error('SuiWalletService', 'Error getting recent transactions', { error });
            throw new Error('Failed to get recent transactions');
        }
    }
} 