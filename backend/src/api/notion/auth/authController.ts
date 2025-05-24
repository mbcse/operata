import { NotionService } from "@/common/notion";
import { Request, RequestHandler, Response } from "express";
import { Logger } from "@/common/utils/logger";
import { SuiWalletService } from "@/common/walletService/suiWallet";

export const handleNotionAuthCallback: RequestHandler = async (req: Request, res: Response) => {
    const { code } = req.body;

    Logger.info('AuthController', 'Handling Notion auth callback', { code });

    try {
        if (!code) return res.status(403).json({
            error: "Failed to Authenticate",
            message: "Notion Auth Failure"
        });

        const user = await NotionService.handleUserAuthCode(code);
        Logger.info('AuthController', 'User authenticated with Notion', { userId: user.id });

        // Create SUI wallet and keypair
        const suiWalletService = new SuiWalletService();
        const { walletId, address } = await suiWalletService.createWallet(user.id);
        Logger.info('AuthController', 'Created SUI wallet', { walletId, address });

        const notionClient = new NotionService(user.notionToken, user.workspaceId);
        await notionClient.createWalletPage(user.id);

        res.status(200).json({
            workspaceId: user.workspaceId,
            walletId,
            address
        });

    } catch (error) {
        Logger.error('AuthController', 'Error handling Notion auth callback', { error });
        return res.status(500).json({
            error: "Server Error"
        });
    }
};