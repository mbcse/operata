import { Request, RequestHandler, Response } from "express";
import { NotionWebhookHandler } from "./webhookHandler";
import { prisma } from "@/database";
import { Logger } from "@/common/utils/logger";

export const handleNotionWebhook: RequestHandler = async (req: Request, res: Response) => {
    try {
        console.log(req.body)
        const event  = req.body;
        Logger.info('WebhookController', 'Webhook received', { event });

        // Get the workspace from the event
        const workspace = await prisma.walletWorkspace.findFirst({
            where: {
                notionData: {
                    path: ['workspace_id'],
                    equals: event.workspace_id
                }
            }
        });

        if (!workspace) {
            Logger.error('WebhookController', 'Workspace not found for webhook', { workspaceId: event.workspace_id });
            return res.status(404).json({ error: 'Workspace not found' });
        }

        // Create webhook handler with workspace's Notion token
        const webhookHandler = new NotionWebhookHandler(workspace.notionToken);

        // Process the webhook
        await webhookHandler.handleWebhook(event);

        res.status(200).json({ success: true });
    } catch (error) {
        Logger.error('WebhookController', 'Error handling webhook', { error });
        res.status(500).json({ error: 'Internal server error' });
    }
};