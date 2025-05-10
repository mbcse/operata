import {PrivyClient} from '@privy-io/server-auth';
import { env } from '../utils/envConfig';
import { prisma } from '@/database';

interface TransactionRequest {
    to: `0x${string}`;  // Ethereum address format
    value: `0x${string}`;  // Hex string in wei
    data?: `0x${string}`;  // Hex string
    chainId: number;
}

class PrivyService {
    privy: PrivyClient

    constructor(){
        this.privy = new PrivyClient(env.PRIVY_APP_ID, env.PRIVY_APP_SECRET);
    }

    async createWallet(workspaceId: string) {
        // Create wallet using Privy
        const {id, address, chainType} = await this.privy.walletApi.create({chainType: 'ethereum'});

        // Store wallet in database
        const wallet = await prisma.wallet.create({
            data: {
                id,
                address,
                chainType,
                workspaceId
            }
        });

        return wallet;
    }

    async signMessage(walletId: string, message: string) {
        try {
            const {signature, encoding} = await this.privy.walletApi.ethereum.signMessage({
                walletId,
                message
            });

            return {signature, encoding};
        } catch (error) {
            console.error('Error signing message:', error);
            throw new Error('Failed to sign message');
        }
    }

    async sendTransaction(walletId: string, transaction: TransactionRequest) {
        try {
            // Send transaction using Privy
            const data = await this.privy.walletApi.ethereum.sendTransaction({
                walletId,
                caip2: `eip155:${transaction.chainId}`,
                transaction: {
                    to: transaction.to,
                    value: transaction.value,
                    data: transaction.data,
                    chainId: transaction.chainId
                }
            }); 

            // Get wallet for the from address
            const wallet = await this.getWalletById(walletId);

            // Store transaction in database for tracking
            await prisma.$transaction(async (tx) => {
                await tx.transaction.create({
                    data: {
                        hash: data.hash,
                        from: wallet.address,
                        to: transaction.to,
                        value: transaction.value,
                        status: 'PENDING',
                        walletId
                    }
                });
            });

            return data.hash;
        } catch (error) {
            console.error('Error sending transaction:', error);
            throw new Error('Failed to send transaction');
        }
    }

    async getWalletById(walletId: string) {
        const wallet = await prisma.wallet.findUnique({
            where: { id: walletId }
        });

        if (!wallet) {
            throw new Error('Wallet not found');
        }

        return wallet;
    }

    async getWallets(workspaceId: string) {
        return prisma.wallet.findMany({
            where: { workspaceId }
        });
    }

    async getTransactions(walletId: string) {
        return prisma.transaction.findMany({
            where: { walletId },
            orderBy: { createdAt: 'desc' }
        });
    }

    
}

// Export the service
export default PrivyService;