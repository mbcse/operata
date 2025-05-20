import { Client } from "@notionhq/client";
import { env } from "../utils/envConfig";
import { prisma } from "@/database";
import { BlockObjectRequest, GetPageResponse, PageObjectResponse } from "@notionhq/client/build/src/api-endpoints";
import { Logger } from "../utils/logger";
import { SuiWalletService } from '../walletService/suiWallet';

// Interface for the generic wallet client
interface WalletClient {
  executeTransaction(transactionId: string, toAddress: string, amount: number): Promise<{ transactionHash: string }>;
}

// Interface for Notion page creation response
interface WalletPageResponse {
  pageId: string;
  nftPageId: string;
  transactionsPageId: string;
  subWalletsPageId: string;
  sendMoneyPageId: string;
  receivedTransactionsPageId: string;
}

// Interface for transaction data
interface TransactionData {
  description: string;
  amount: number;
  from: string;
  to: string;
  status: "Pending" | "Success" | "Failed";
  auth: "None" | "Pending" | "Approved" | "Rejected";
  date: string;
  transactionHash?: string;
  approvals?: { approverId: string; status: "Approved" | "Rejected" }[];
}

// Interface for sub-wallet data
interface SubWalletData {
  name: string;
  walletAddress: string;
  assignedTo: string;
  balance: number;
  monthlyLimit: number;
  status: "Active" | "Inactive" | "Frozen";
}

// Interface for NFT data
interface NFTData {
  name: string;
  tokenId: number;
  contractAddress: string;
  attributes?: { trait_type: string; value: string }[];
  description?: string;
  imageUrl?: string;
  receiveDate?: string;
  transactionHash?: string;
  walletContext?: string;
}

// Interface for scheduled transaction data
interface ScheduledTransactionData {
  transactionName: string;
  toAddress: string;
  description: string;
  amount: number;
  tokenName: string;
  scheduleDate: string;
  operataStatus: "Pending" | "Processing" | "Completed" | "Failed";
  adminStatus: "Scheduled" | "Approved";
  walletContext?: string;
}

// Interface for received transaction data
interface ReceivedTransactionData {
  fromAddress: string;
  amount: number;
  tokenName: string;
  transactionHash: string;
  date: string;
  status: "Pending" | "Confirmed" | "Failed";
  notes?: string;
}

export class NotionService {
  private client: Client;
  private walletClient?: WalletClient;
  private workspaceId: string;
  private notionToken: string;
  private databaseIds: {
    transactions?: { [walletId: string]: string };
    subWallets?: string;
    nfts?: { [walletId: string]: string };
    scheduleTransactions?: { [walletId: string]: string };
    receivedTransactions?: { [walletId: string]: string };
  } = {};

  constructor(notionToken: string, workspaceId?: string, walletClient?: WalletClient) {
    console.log(`[NotionService] Initializing with token and workspaceId: ${workspaceId || 'not provided'}`);
    this.client = new Client({ auth: notionToken });
    this.walletClient = walletClient;
    this.workspaceId = workspaceId || '';
    this.notionToken = notionToken;
  }

  private async initializeWorkspaceId(): Promise<void> {
    if (this.workspaceId) {
      return;
    }

    try {
      // Find workspace by token
      const workspace = await prisma.walletWorkspace.findFirst({
        where: { notionToken: this.notionToken }
      });

      if (!workspace) {
        console.error('[initializeWorkspaceId] No workspace found for the provided token');
        throw new Error('No workspace found for the provided token. Please ensure the workspace is created first.');
      }

      this.workspaceId = workspace.workspaceId;
      console.log(`[initializeWorkspaceId] Found workspace ID: ${this.workspaceId}`);
    } catch (error) {
      console.error('[initializeWorkspaceId] Error getting workspace ID:', error);
      throw new Error(`Failed to get workspace ID: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async ensureWorkspaceId(): Promise<void> {
    if (!this.workspaceId) {
      await this.initializeWorkspaceId();
    }
  }

  private async getWalletId(): Promise<string> {
    try {
      await this.ensureWorkspaceId();

      // First ensure the workspace exists
      const workspace = await prisma.walletWorkspace.findUnique({
        where: { workspaceId: this.workspaceId }
      });

      if (!workspace) {
        console.error(`[getWalletId] Workspace with ID ${this.workspaceId} not found`);
        throw new Error(`Workspace with ID ${this.workspaceId} not found. Please ensure the workspace is created before accessing wallet.`);
      }

      // Find the wallet for this workspace
      const wallet = await prisma.wallet.findFirst({
        where: { workspaceId: workspace.id }
      });

      if (!wallet) {
        console.error(`[getWalletId] No wallet found for workspace ID ${this.workspaceId}`);
        throw new Error(`No wallet found for workspace ID ${this.workspaceId}. Please create a wallet first.`);
      }

      return wallet.id;
    } catch (error) {
      console.error("[getWalletId] Error getting wallet ID:", error);
      throw new Error(`Failed to get wallet ID: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Type guard to check if GetPageResponse is PageObjectResponse
  private isPageObjectResponse(response: GetPageResponse): response is PageObjectResponse {
    return "properties" in response;
  }

  async createWalletPage(userName: string): Promise<WalletPageResponse> {
    console.log(`[createWalletPage] Starting wallet page creation for user: ${userName}`);
    try {
      const parentPage = await this.client.pages.create({
        parent: { type: "page_id", page_id: await this.getWorkspaceId() },
        icon: { type: "emoji", emoji: "💰" },
        properties: {
          title: {
            type: "title",
            title: [{ type: "text", text: { content: `Operata Wallet - ${userName}` } }],
          },
        },
      });
      console.log(`[createWalletPage] Created parent page with ID: ${parentPage.id}`);

      // Create sub-pages sequentially
      const nftPage = await this.createSubPage(parentPage.id, "NFT Collection", "🎨");
      console.log(`[createWalletPage] Created NFT page with ID: ${nftPage.id}`);
      
      const transactionsPage = await this.createSubPage(parentPage.id, "Transactions", "💳");
      console.log(`[createWalletPage] Created transactions page with ID: ${transactionsPage.id}`);
      
      const subWalletsPage = await this.createSubPage(parentPage.id, "Sub-Wallets", "👥");
      console.log(`[createWalletPage] Created sub-wallets page with ID: ${subWalletsPage.id}`);
      
      const scheduleTransactionsPage = await this.createSubPage(parentPage.id, "Schedule Transactions", "⏰");
      console.log(`[createWalletPage] Created schedule transactions page with ID: ${scheduleTransactionsPage.id}`);
      
      const receivedTransactionsPage = await this.createSubPage(parentPage.id, "Crypto Received Transactions", "📥");
      console.log(`[createWalletPage] Created received transactions page with ID: ${receivedTransactionsPage.id}`);

      // Create databases sequentially and store their IDs
      const nftDatabaseId = await this.createNFTDatabase(nftPage.id, "Main Wallet");
      console.log(`[createWalletPage] Created NFT database with ID: ${nftDatabaseId}`);
      
      const transactionsDatabaseId = await this.createTransactionsDatabase(transactionsPage.id, "Main Wallet");
      console.log(`[createWalletPage] Created transactions database with ID: ${transactionsDatabaseId}`);
      
      const subWalletsDatabaseId = await this.createSubWalletsDatabase(subWalletsPage.id);
      console.log(`[createWalletPage] Created sub-wallets database with ID: ${subWalletsDatabaseId}`);
      
      const scheduleTransactionsDatabaseId = await this.createScheduleTransactionsDatabase(scheduleTransactionsPage.id, "Main Wallet");
      console.log(`[createWalletPage] Created schedule transactions database with ID: ${scheduleTransactionsDatabaseId}`);
      
      const receivedTransactionsDatabaseId = await this.createReceivedTransactionsDatabase(receivedTransactionsPage.id, "Main Wallet");
      console.log(`[createWalletPage] Created received transactions database with ID: ${receivedTransactionsDatabaseId}`);

      console.log("[createWalletPage] Checking workspace", this.workspaceId);
      
      // First ensure the workspace exists
      const workspace = await prisma.walletWorkspace.findUnique({
        where: { workspaceId: this.workspaceId }
      });

      if (!workspace) {
        console.error(`[createWalletPage] Workspace with ID ${this.workspaceId} not found`);
        throw new Error(`Workspace with ID ${this.workspaceId} not found. Please ensure the workspace is created before creating a wallet.`);
      }

      // Find or create the wallet
      const wallet = await prisma.wallet.findFirst({
        where: { workspaceId: workspace.id }
      });

      if (!wallet) {
        console.log("[createWalletPage] Creating new wallet");
        // Create a new wallet if it doesn't exist
        await prisma.wallet.create({
          data: {
            id: `wallet-${Date.now()}`, // Generate a unique ID
            address: `0x${Date.now().toString(16)}`, // Generate a temporary address
            chainType: "SUI", // Default chain type
            workspaceId: workspace.id, // Use the workspace.id instead of workspaceId
            notionPageId: parentPage.id,
            nftDatabaseId,
            transactionsDatabaseId,
            subWalletsDatabaseId,
            scheduleTransactionsDatabaseId,
            receivedTransactionsDatabaseId
          }
        });
      } else {
        console.log("[createWalletPage] Updating existing wallet");
        // Update existing wallet
        await prisma.wallet.update({
          where: { id: wallet.id },
          data: {
            notionPageId: parentPage.id,
            nftDatabaseId,
            transactionsDatabaseId,
            subWalletsDatabaseId,
            scheduleTransactionsDatabaseId,
            receivedTransactionsDatabaseId
          }
        });
      }

      await this.createDashboard(parentPage.id, {
        nftPageId: nftPage.id,
        transactionsPageId: transactionsPage.id,
        subWalletsPageId: subWalletsPage.id,
        sendMoneyPageId: scheduleTransactionsPage.id,
        receivedTransactionsPageId: receivedTransactionsPage.id,
      });
      console.log("[createWalletPage] Created dashboard");

      const response = {
        pageId: parentPage.id,
        nftPageId: nftPage.id,
        transactionsPageId: transactionsPage.id,
        subWalletsPageId: subWalletsPage.id,
        sendMoneyPageId: scheduleTransactionsPage.id,
        receivedTransactionsPageId: receivedTransactionsPage.id,
      };
      console.log("[createWalletPage] Successfully completed wallet page creation", response);
      return response;
    } catch (error) {
      console.error("[createWalletPage] Error creating wallet page:", error);
      throw new Error(`Failed to create wallet page: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async createSubPage(parentId: string, title: string, emoji: string) {
    console.log(`[createSubPage] Creating sub-page: ${title} with emoji: ${emoji}`);
    try {
      const response = await this.client.pages.create({
      parent: { type: "page_id", page_id: parentId },
      icon: { type: "emoji", emoji: emoji as any },
      properties: { title: { type: "title", title: [{ type: "text", text: { content: title } }] } },
    });
      console.log(`[createSubPage] Successfully created sub-page: ${title} with ID: ${response.id}`);
      return response;
    } catch (error) {
      console.error(`[createSubPage] Error creating sub-page ${title}:`, error);
      throw error;
    }
  }

  private async createNFTDatabase(parentId: string, walletContext: string) {
    const database = await this.client.databases.create({
      parent: { page_id: parentId },
      title: [{ type: "text", text: { content: `NFT Collection - ${walletContext}` } }],
      properties: {
        Name: { title: {} },
        "Token ID": { number: {} },
        "Contract Address": { rich_text: {} },
        Attributes: { rich_text: {} },
        Description: { rich_text: {} },
        "Image URL": { url: {} },
        "Receive Date": { date: {} },
        "Transaction Hash": { rich_text: {} },
        "NFT Preview": { files: {} }
      },
      is_inline: true
    });

    if (!this.databaseIds.nfts) {
      this.databaseIds.nfts = {};
    }
    this.databaseIds.nfts[walletContext] = database.id;
    return database.id;
  }

  private async createTransactionsDatabase(parentId: string, walletContext: string) {
    const database = await this.client.databases.create({
      parent: { page_id: parentId },
      title: [{ type: "text", text: { content: `Transactions - ${walletContext}` } }],
      properties: {
        Description: { title: {} },
        Amount: { number: { format: "number" } },
        From: { rich_text: {} },
        To: { rich_text: {} },
        "Token Name": {
          select: {
            options: [
              { name: "SUI", color: "blue" },
              { name: "USDC", color: "green" }
            ]
          }
        },
        Status: {
          select: {
            options: [
              { name: "Pending", color: "yellow" },
              { name: "Success", color: "green" },
              { name: "Failed", color: "red" }
            ]
          }
        },
        Date: { date: {} },
        "Transaction Hash": { rich_text: {} }
      }
    });

    if (!this.databaseIds.transactions) {
      this.databaseIds.transactions = {};
    }
    this.databaseIds.transactions[walletContext] = database.id;
    return database.id;
  }

  private async createSubWalletsDatabase(parentId: string) {
    const database = await this.client.databases.create({
      parent: { page_id: parentId },
      title: [{ type: "text", text: { content: "Sub-Wallets" } }],
      properties: {
        Name: { title: {} },
        "Wallet Address": { rich_text: {} },
        "Assigned To": { rich_text: {} },
        Balance: { number: { format: "dollar" } },
        "Monthly Limit": { number: {} },
        Status: {
          select: {
            options: [
              { name: "Active", color: "green" },
              { name: "Inactive", color: "red" },
              { name: "Frozen", color: "gray" },
            ],
          },
        },
        "Created Date": { date: {} },
      },
    });
    this.databaseIds.subWallets = database.id;
    return database.id;
  }

  private async createScheduleTransactionsDatabase(parentId: string, walletContext: string) {
    const database = await this.client.databases.create({
      parent: { page_id: parentId },
      title: [{ type: "text", text: { content: `Schedule Transactions - ${walletContext}` } }],
      properties: {
        "Transaction Name": { title: {} },
        "To Address": { rich_text: {} },
        Description: { rich_text: {} },
        Amount: { number: { format: "number" } },
        "Token Name": {
          select: {
            options: [
              { name: "SUI", color: "blue" },
              { name: "USDC", color: "green" }
            ]
          }
        },
        "Schedule Date": { date: {} },
        "Admin Status": {
          select: {
            options: [
              { name: "Scheduled", color: "yellow" },
              { name: "Approved", color: "green" }
            ]
          }
        },
        "Operata Status": {
          select: {
            options: [
              { name: "Pending", color: "yellow" },
              { name: "Processing", color: "blue" },
              { name: "Completed", color: "green" },
              { name: "Failed", color: "red" }
            ]
          }
        }
      }
    });

    if (!this.databaseIds.scheduleTransactions) {
      this.databaseIds.scheduleTransactions = {};
    }
    this.databaseIds.scheduleTransactions[walletContext] = database.id;
    return database.id;
  }

  async createSubWalletScheduleTransactionsDatabase(walletName: string) {
    const parentPage = await this.getWorkspaceId();
    const scheduleTransactionsPage = await this.createSubPage(parentPage, "Schedule Transactions", "⏰");
    return this.createScheduleTransactionsDatabase(scheduleTransactionsPage.id, walletName);
  }

  private async createReceivedTransactionsDatabase(parentId: string, walletContext: string) {
    const database = await this.client.databases.create({
      parent: { page_id: parentId },
      title: [{ type: "text", text: { content: `Received Transactions - ${walletContext}` } }],
      properties: {
        "From Address": { title: {} },
        Amount: { number: { format: "number" } },
        "Token Name": {
          select: {
            options: [
              { name: "SUI", color: "blue" },
              { name: "USDC", color: "green" }
            ]
          }
        },
        "Transaction Hash": { rich_text: {} },
        Date: { date: {} },
        Status: {
          select: {
            options: [
              { name: "Pending", color: "yellow" },
              { name: "Confirmed", color: "green" },
              { name: "Failed", color: "red" }
            ]
          }
        }
      }
    });

    if (!this.databaseIds.receivedTransactions) {
      this.databaseIds.receivedTransactions = {};
    }
    this.databaseIds.receivedTransactions[walletContext] = database.id;
    return database.id;
  }

  private async createDashboard(parentId: string, pageIds: Omit<WalletPageResponse, "pageId">) {
    try {
      // Create the main layout with two columns
      const columnListBlock = await this.client.blocks.children.append({
        block_id: parentId,
        children: [{
          object: "block",
          type: "column_list",
          column_list: {
            children: [
              { object: "block", type: "column", column: { children: [] } },
              { object: "block", type: "column", column: { children: [] } }
            ]
          }
        }] as BlockObjectRequest[]
      });

      // Get the column IDs
      const columnListBlockId = columnListBlock.results[0].id;
      const columnBlocks = await this.client.blocks.children.list({ block_id: columnListBlockId });
      const [leftColumnId, rightColumnId] = columnBlocks.results.map((block: any) => block.id);

      // Get wallet info
      const wallet = await prisma.wallet.findFirst({
        where: { notionPageId: parentId }
      });

      if (!wallet) {
        throw new Error('Wallet not found for dashboard creation');
      }

      // Create sidebar content
      const sidebarContent: BlockObjectRequest[] = [
      { object: "block", type: "heading_2", heading_2: { rich_text: [{ type: "text", text: { content: "📱 Navigation" } }], color: "default" } },
      { object: "block", type: "divider", divider: {} },
      { object: "block", type: "callout", callout: { rich_text: [{ type: "text", text: { content: "Quick Actions" } }], color: "gray_background", icon: { emoji: "⚡" } } },
      { object: "block", type: "link_to_page", link_to_page: { type: "page_id", page_id: pageIds.sendMoneyPageId } },
      { object: "block", type: "link_to_page", link_to_page: { type: "page_id", page_id: pageIds.receivedTransactionsPageId } },
      { object: "block", type: "divider", divider: {} },
      { object: "block", type: "callout", callout: { rich_text: [{ type: "text", text: { content: "Sections" } }], color: "gray_background", icon: { emoji: "📑" } } },
      { object: "block", type: "link_to_page", link_to_page: { type: "page_id", page_id: pageIds.nftPageId } },
      { object: "block", type: "link_to_page", link_to_page: { type: "page_id", page_id: pageIds.transactionsPageId } },
      { object: "block", type: "link_to_page", link_to_page: { type: "page_id", page_id: pageIds.subWalletsPageId } },
      { object: "block", type: "divider", divider: {} },
      { object: "block", type: "callout", callout: { rich_text: [{ type: "text", text: { content: "AI Assistant" } }], color: "purple_background", icon: { emoji: "🤖" } } },
        { object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: "💡 Ask me anything about your finances!" } }], color: "default" } }
    ];

      // Create main content
      const mainContent: BlockObjectRequest[] = [
      { object: "block", type: "heading_1", heading_1: { rich_text: [{ type: "text", text: { content: "📊 Dashboard" } }], color: "default" } },
        { 
          object: "block", 
          type: "callout", 
          callout: { 
            rich_text: [{ 
              type: "text", 
              text: { content: `Wallet Address:\n${wallet.address}` }
            }],
            color: "blue_background",
            icon: { emoji: "🔑" }
          }
        },
      { 
        object: "block", 
        type: "toggle", 
        toggle: { 
          rich_text: [{ 
            type: "text", 
              text: { content: "🔄 Click to Sync Data" }
          }],
          color: "blue_background"
        }
      },
      { 
        object: "block", 
        type: "paragraph", 
        paragraph: { 
          rich_text: [{ 
            type: "text", 
              text: { content: "Status: Not Synced" }
          }],
          color: "default"
        }
      },
      { 
        object: "block", 
        type: "paragraph", 
        paragraph: { 
          rich_text: [{ 
            type: "text", 
              text: { content: "Click the sync button above to update your dashboard with the latest data" }
          }],
          color: "default"
        }
      },
      { object: "block", type: "divider", divider: {} },
      { object: "block", type: "callout", callout: { rich_text: [{ type: "text", text: { content: "Portfolio Overview" } }], color: "gray_background", icon: { emoji: "📈" } } },
      {
        object: "block",
        type: "column_list",
        column_list: {
          children: [
              { object: "block", type: "column", column: { children: [{ object: "block", type: "callout", callout: { rich_text: [{ type: "text", text: { content: "SUI Balance\n0" } }], color: "blue_background", icon: { emoji: "💰" } } }] } },
              { object: "block", type: "column", column: { children: [{ object: "block", type: "callout", callout: { rich_text: [{ type: "text", text: { content: "USDC Balance\n0" } }], color: "green_background", icon: { emoji: "💵" } } }] } },
              { object: "block", type: "column", column: { children: [{ object: "block", type: "callout", callout: { rich_text: [{ type: "text", text: { content: "Total NFTs\n0" } }], color: "purple_background", icon: { emoji: "🎨" } } }] } },
              { object: "block", type: "column", column: { children: [{ object: "block", type: "callout", callout: { rich_text: [{ type: "text", text: { content: "Sub-wallets\n0" } }], color: "orange_background", icon: { emoji: "👛" } } }] } }
            ]
          }
      },
      { object: "block", type: "divider", divider: {} },
        { object: "block", type: "callout", callout: { rich_text: [{ type: "text", text: { content: "Recent Activity" } }], color: "gray_background", icon: { emoji: "📅" } } }
      ];

      // Add content to columns one by one to ensure proper order
      await this.client.blocks.children.append({ block_id: leftColumnId, children: sidebarContent });
      await this.client.blocks.children.append({ block_id: rightColumnId, children: mainContent });

      console.log("Dashboard created successfully");
    } catch (error) {
      console.error("Error creating dashboard:", error);
      throw new Error(`Failed to create dashboard: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async getWorkspaceId(): Promise<string> {
    try {
      const response = await this.client.search({ filter: { value: "page", property: "object" } });
      const workspacePage = response.results.find((result: any) => result.parent?.type === "workspace" || result.parent?.workspace === true);

      if (!workspacePage) {
        const newPage = await this.client.pages.create({
          parent: { type: "page_id", page_id: response.results[0]?.id },
          properties: { title: { type: "title", title: [{ type: "text", text: { content: "Operata Wallet Workspace" } }] } },
        });
        return newPage.id;
      }
      return workspacePage.id;
    } catch (error) {
      console.error("Error in getWorkspaceId:", error);
      throw new Error(`Failed to get or create workspace root page: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  static async handleUserAuthCode(code: string) {
    try {
      const tokenEndpoint = "https://api.notion.com/v1/oauth/token";
      const encoded = Buffer.from(`${env.NOTION_CLIENT_ID}:${env.NOTION_CLIENT_SECRET}`).toString("base64");
      const res = await fetch(tokenEndpoint, {
        headers: { Authorization: `Basic ${encoded}`, "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ grant_type: "authorization_code", code, redirect_uri: env.MAIN_APP_FRONT_URL }),
      });

      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const response = await res.json();
      console.log("response form notion", response)

      const user = await prisma.walletWorkspace.upsert({
        where: { workspaceId: response.workspace_id },
        update: { notionData: response, notionToken: response.access_token },
        create: { notionToken: response.access_token, notionData: response, workspaceId: response.workspace_id },
      });

      console.log("save response", user)

      return user;
    } catch (error) {
      console.error("Error handling user auth code:", error);
      throw new Error(`Failed to handle auth code: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async addTransaction(transactionData: TransactionData) {
    console.log("[addTransaction] Starting transaction addition", transactionData);
    try {
      if (!transactionData.description || !transactionData.from || !transactionData.to || !transactionData.date) {
        console.error("[addTransaction] Missing required transaction fields");
        throw new Error("Missing required transaction fields: description, from, to, or date");
      }
      const response = await this.client.pages.create({
        parent: { database_id: await this.getTransactionsDatabaseId() },
        properties: {
          Description: { title: [{ type: "text", text: { content: transactionData.description } }] },
          Amount: { number: transactionData.amount },
          From: { rich_text: [{ type: "text", text: { content: transactionData.from } }] },
          To: { rich_text: [{ type: "text", text: { content: transactionData.to } }] },
          Status: { select: { name: transactionData.status } },
          Auth: { select: { name: transactionData.auth } },
          Approvals: { multi_select: transactionData.approvals?.map((a) => ({ name: `${a.approverId}:${a.status}` })) || [] },
          Date: { date: { start: transactionData.date } },
          "Transaction Hash": { rich_text: [{ type: "text", text: { content: transactionData.transactionHash || "" } }] },
        },
      });
      console.log("[addTransaction] Successfully added transaction", response);
      return response;
    } catch (error) {
      console.error("[addTransaction] Error adding transaction:", error);
      throw new Error(`Failed to add transaction: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async deleteTransaction(transactionId: string) {
    console.log(`[deleteTransaction] Starting transaction deletion for ID: ${transactionId}`);
    try {
      await this.client.pages.update({ page_id: transactionId, archived: true });
      console.log(`[deleteTransaction] Successfully deleted transaction: ${transactionId}`);
      return { success: true, message: `Transaction ${transactionId} deleted` };
    } catch (error) {
      console.error(`[deleteTransaction] Error deleting transaction ${transactionId}:`, error);
      throw new Error(`Failed to delete transaction: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async addSubWallet(walletData: SubWalletData) {
    console.log("[addSubWallet] Starting sub-wallet addition", walletData);
    try {
      if (!walletData.name || !walletData.walletAddress || !walletData.assignedTo) {
        console.error("[addSubWallet] Missing required sub-wallet fields");
        throw new Error("Missing required sub-wallet fields: name, walletAddress, or assignedTo");
      }
      const response = await this.client.pages.create({
        parent: { database_id: await this.getSubWalletsDatabaseId() },
        properties: {
          Name: { title: [{ type: "text", text: { content: walletData.name } }] },
          "Wallet Address": { rich_text: [{ type: "text", text: { content: walletData.walletAddress } }] },
          "Assigned To": { rich_text: [{ type: "text", text: { content: walletData.assignedTo } }] },
          Balance: { number: walletData.balance },
          "Monthly Limit": { number: walletData.monthlyLimit },
          Status: { select: { name: walletData.status } },
          "Created Date": { date: { start: new Date().toISOString() } }, 
        },
      });
      console.log("[addSubWallet] Successfully added sub-wallet", response);
      return response;
    } catch (error) {
      console.error("[addSubWallet] Error adding sub-wallet:", error);
      throw new Error(`Failed to add sub-wallet: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async deleteSubWallet(walletId: string) {
    console.log(`[deleteSubWallet] Starting sub-wallet deletion for ID: ${walletId}`);
    try {
      await this.client.pages.update({ page_id: walletId, archived: true });
      console.log(`[deleteSubWallet] Successfully deleted sub-wallet: ${walletId}`);
      return { success: true, message: `Sub-wallet ${walletId} deleted` };
    } catch (error) {
      console.error(`[deleteSubWallet] Error deleting sub-wallet ${walletId}:`, error);
      throw new Error(`Failed to delete sub-wallet: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async addNFT(nftData: NFTData) {
    console.log("[addNFT] Starting NFT addition", nftData);
    try {
      if (!nftData.name || !nftData.tokenId || !nftData.contractAddress) {
        console.error("[addNFT] Missing required NFT fields");
        throw new Error("Missing required NFT fields: name, tokenId, or contractAddress");
      }
      const walletContext = nftData.walletContext || "Main Wallet";
      const databaseId = await this.getNFTDatabaseId(walletContext);
      console.log(`[addNFT] Using database ID: ${databaseId} for wallet context: ${walletContext}`);

      const properties: Record<string, any> = {
        Name: { title: [{ type: "text", text: { content: nftData.name } }] },
        "Token ID": { number: nftData.tokenId },
        "Contract Address": { rich_text: [{ type: "text", text: { content: nftData.contractAddress } }] },
        Attributes: { rich_text: [{ type: "text", text: { content: JSON.stringify(nftData.attributes || []) } }] },
        Description: { rich_text: [{ type: "text", text: { content: nftData.description || "" } }] },
        "Image URL": nftData.imageUrl ? { url: nftData.imageUrl } : null,
        "Receive Date": { date: { start: nftData.receiveDate || new Date().toISOString() } },
        "Transaction Hash": { rich_text: [{ type: "text", text: { content: nftData.transactionHash || "" } }] }
      };

      const response = await this.client.pages.create({
        parent: { database_id: databaseId },
        properties
      });
      console.log("[addNFT] Successfully added NFT", response);
      return response;
    } catch (error) {
      console.error("[addNFT] Error adding NFT:", error);
      throw new Error(`Failed to add NFT: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async deleteNFT(nftId: string) {
    console.log(`[deleteNFT] Starting NFT deletion for ID: ${nftId}`);
    try {
      await this.client.pages.update({ page_id: nftId, archived: true });
      console.log(`[deleteNFT] Successfully deleted NFT: ${nftId}`);
      return { success: true, message: `NFT ${nftId} deleted` };
    } catch (error) {
      console.error(`[deleteNFT] Error deleting NFT ${nftId}:`, error);
      throw new Error(`Failed to delete NFT: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async scheduleTransaction(transactionData: ScheduledTransactionData) {
    console.log("[scheduleTransaction] Starting transaction scheduling", transactionData);
    try {
      if (!transactionData.transactionName || !transactionData.toAddress || !transactionData.amount || !transactionData.scheduleDate) {
        console.error("[scheduleTransaction] Missing required fields");
        throw new Error("Missing required fields: transactionName, toAddress, amount, or scheduleDate");
      }

      const walletContext = transactionData.walletContext || "Main Wallet";
      const databaseId = await this.getScheduleTransactionsDatabaseId(walletContext);
      console.log(`[scheduleTransaction] Using database ID: ${databaseId} for wallet context: ${walletContext}`);

      const response = await this.client.pages.create({
        parent: { database_id: databaseId },
        properties: {
          "Transaction Name": { title: [{ type: "text", text: { content: transactionData.transactionName } }] },
          "To Address": { rich_text: [{ type: "text", text: { content: transactionData.toAddress } }] },
          Description: { rich_text: [{ type: "text", text: { content: transactionData.description } }] },
          Amount: { number: transactionData.amount },
          "Token Name": { select: { name: transactionData.tokenName } },
          "Schedule Date": { date: { start: transactionData.scheduleDate } },
          "Admin Status": { select: { name: transactionData.adminStatus } },
          "Operata Status": { select: { name: transactionData.operataStatus } }
        }
      });
      console.log("[scheduleTransaction] Successfully scheduled transaction", response);
      return response;
    } catch (error) {
      console.error("[scheduleTransaction] Error scheduling transaction:", error);
      throw new Error(`Failed to schedule transaction: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getScheduleTransactionsDatabaseId(walletContext: string = "Main Wallet"): Promise<string> {
    console.log(`[getScheduleTransactionsDatabaseId] Getting database ID for wallet context: ${walletContext}`);
    try {
      const wallet = await prisma.wallet.findUnique({
        where: { id: await this.getWalletId() }
      });
      if (!wallet?.scheduleTransactionsDatabaseId) {
        console.error(`[getScheduleTransactionsDatabaseId] Database not found for ${walletContext}`);
        throw new Error(`Schedule Transactions database for ${walletContext} not found`);
      }
      console.log(`[getScheduleTransactionsDatabaseId] Found database ID: ${wallet.scheduleTransactionsDatabaseId}`);
      return wallet.scheduleTransactionsDatabaseId;
    } catch (error) {
      console.error("[getScheduleTransactionsDatabaseId] Error:", error);
      throw error;
    }
  }

  async getScheduledTransactions(walletContext: string = "Main Wallet") {
    console.log(`[getScheduledTransactions] Getting scheduled transactions for wallet context: ${walletContext}`);
    try {
      const databaseId = await this.getScheduleTransactionsDatabaseId(walletContext);
      const response = await this.client.databases.query({
        database_id: databaseId,
        filter: { property: "Admin Status", select: { equals: "Scheduled" } }
      });
      console.log(`[getScheduledTransactions] Found ${response.results.length} scheduled transactions`);
      return response.results;
    } catch (error) {
      console.error("[getScheduledTransactions] Error:", error);
      throw new Error(`Failed to get scheduled transactions: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async addReceivedTransaction(transactionData: ReceivedTransactionData) {
    console.log("[addReceivedTransaction] Starting received transaction addition", transactionData);
    try {
      // Validate required fields
      if (!transactionData.fromAddress || !transactionData.transactionHash) {
        console.error("[addReceivedTransaction] Missing required fields");
        throw new Error("Missing required received transaction fields: fromAddress or transactionHash");
      }

      // Ensure amount is a valid number
      const amount = typeof transactionData.amount === 'number' ? transactionData.amount : 0;
      const tokenName = transactionData.tokenName || 'SUI';
      const date = transactionData.date || new Date().toISOString();
      const status = transactionData.status || 'Pending';

      const response = await this.client.pages.create({
        parent: { database_id: await this.getReceivedTransactionsDatabaseId() },
        properties: {
          "From Address": { title: [{ type: "text", text: { content: transactionData.fromAddress } }] },
          Amount: { number: amount },
          "Token Name": { select: { name: tokenName } },
          "Transaction Hash": { rich_text: [{ type: "text", text: { content: transactionData.transactionHash } }] },
          Date: { date: { start: date } },
          Status: { select: { name: status } }
        },
      });
      console.log("[addReceivedTransaction] Successfully added received transaction", response);
      return response;
    } catch (error) {
      console.error("[addReceivedTransaction] Error:", error);
      throw new Error(`Failed to add received transaction: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getRecentReceivedTransactions(limit: number = 5) {
    console.log(`[getRecentReceivedTransactions] Getting ${limit} recent received transactions`);
    try {
      const databaseId = await this.getReceivedTransactionsDatabaseId();
      const response = await this.client.databases.query({
        database_id: databaseId,
        sorts: [{ property: "Date", direction: "descending" }],
        page_size: limit,
      });
      console.log(`[getRecentReceivedTransactions] Found ${response.results.length} transactions`);
      return response.results;
    } catch (error) {
      console.error("[getRecentReceivedTransactions] Error:", error);
      throw new Error(`Failed to get recent received transactions: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getReceivedTransactionsDatabaseId(walletContext: string = "Main Wallet"): Promise<string> {
    console.log(`[getReceivedTransactionsDatabaseId] Getting database ID for wallet context: ${walletContext}`);
    try {
      const wallet = await prisma.wallet.findUnique({
        where: { id: await this.getWalletId() }
      });
      if (!wallet?.receivedTransactionsDatabaseId) {
        console.error(`[getReceivedTransactionsDatabaseId] Database not found for ${walletContext}`);
        throw new Error(`Received Transactions database for ${walletContext} not found`);
      }
      console.log(`[getReceivedTransactionsDatabaseId] Found database ID: ${wallet.receivedTransactionsDatabaseId}`);
      return wallet.receivedTransactionsDatabaseId;
    } catch (error) {
      console.error("[getReceivedTransactionsDatabaseId] Error:", error);
      throw error;
    }
  }

  async getTransactionsDatabaseId(walletContext: string = "Main Wallet"): Promise<string> {
    const wallet = await prisma.wallet.findUnique({
      where: { id: await this.getWalletId() }
    });
    if (!wallet?.transactionsDatabaseId) {
      throw new Error(`Transactions database for ${walletContext} not found`);
    }
    return wallet.transactionsDatabaseId;
  }

  async getSubWalletsDatabaseId(): Promise<string> {
    const wallet = await prisma.wallet.findUnique({
      where: { id: await this.getWalletId() }
    });
    if (!wallet?.subWalletsDatabaseId) {
      throw new Error("Sub-Wallets database not found");
    }
    return wallet.subWalletsDatabaseId;
  }

  async getNFTDatabaseId(walletContext: string = "Main Wallet"): Promise<string> {
    const wallet = await prisma.wallet.findUnique({
      where: { id: await this.getWalletId() }
    });
    if (!wallet?.nftDatabaseId) {
      throw new Error(`NFT Collection database for ${walletContext} not found`);
    }
    return wallet.nftDatabaseId;
  }

  async getAllDatabaseRows(databaseId: string) {
    try {
      const response = await this.client.databases.query({
        database_id: databaseId,
      });
      return response.results.map(page => this.parseNotionPage(page));
    } catch (error) {
      console.error("Error getting database rows:", error);
      throw new Error(`Failed to get database rows: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getRowByPageId(pageId: string) {
    try {
      const page = await this.client.pages.retrieve({ page_id: pageId });
      return this.parseNotionPage(page);
    } catch (error) {
      console.error("Error getting row by page ID:", error);
      throw new Error(`Failed to get row: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async updateRowValue(pageId: string, propertyName: string, value: any) {
    try {
      const updateData: any = {};
      updateData[propertyName] = this.convertValueToNotionProperty(value);
      
      await this.client.pages.update({
        page_id: pageId,
        properties: updateData
      });
      return true;
    } catch (error) {
      console.error("Error updating row value:", error);
      throw new Error(`Failed to update row: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async handleDatabaseWebhook(pageId: string) {
    console.log(`[handleDatabaseWebhook] Starting webhook handling for page ID: ${pageId}`);
    try {
      // Get the page to check its parent database
      const page = await this.client.pages.retrieve({ page_id: pageId });
      if (!this.isPageObjectResponse(page)) {
        console.error("[handleDatabaseWebhook] Invalid page response");
        throw new Error("Invalid page response");
      }

      // Get the parent database ID
      const parentId = page.parent.type === 'database_id' ? page.parent.database_id : null;
      if (!parentId) {
        console.error("[handleDatabaseWebhook] Page is not part of a database");
        throw new Error("Page is not part of a database");
      }
      console.log(`[handleDatabaseWebhook] Found parent database ID: ${parentId}`);

      const wallet = await prisma.wallet.findFirst({
        where: {
          OR: [
            { scheduleTransactionsDatabaseId: parentId },
            { transactionsDatabaseId: parentId },
            { nftDatabaseId: parentId },
            { receivedTransactionsDatabaseId: parentId }
          ]
        }
      });

      if (!wallet) {
        console.error("[handleDatabaseWebhook] No matching wallet found for this database");
        throw new Error("No matching wallet found for this database");
      }
      console.log(`[handleDatabaseWebhook] Found matching wallet: ${wallet.id}`);

      // Parse the page data
      const pageData = this.parseNotionPage(page);
      console.log("[handleDatabaseWebhook] Parsed page data:", pageData);

      // Handle based on database type
      if (parentId === wallet.scheduleTransactionsDatabaseId) {
        console.log("[handleDatabaseWebhook] Handling scheduled transaction webhook");
        await this.handleScheduledTransactionWebhook(wallet.id, pageId, pageData);
      } else if (parentId === wallet.transactionsDatabaseId) {
        console.log("[handleDatabaseWebhook] Handling transaction webhook");
        await this.handleTransactionWebhook(wallet.id, pageId, pageData);
      } else if (parentId === wallet.nftDatabaseId) {
        console.log("[handleDatabaseWebhook] Handling NFT webhook");
        await this.handleNFTWebhook(wallet.id, pageId, pageData);
      } else if (parentId === wallet.receivedTransactionsDatabaseId) {
        console.log("[handleDatabaseWebhook] Handling received transaction webhook");
        await this.handleReceivedTransactionWebhook(wallet.id, pageId, pageData);
      }

      console.log("[handleDatabaseWebhook] Successfully handled webhook");
      return true;
    } catch (error) {
      console.error("[handleDatabaseWebhook] Error:", error);
      throw new Error(`Failed to handle webhook: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleScheduledTransactionWebhook(walletId: string, pageId: string, pageData: any) {
    // Check if transaction already exists
    const existingTransaction = await prisma.scheduledTransaction.findUnique({
      where: { notionPageId: pageId }
    });

    if (existingTransaction) {
      // Update existing transaction
      await prisma.scheduledTransaction.update({
        where: { notionPageId: pageId },
        data: {
          transactionName: pageData["Transaction Name"],
          toAddress: pageData["To Address"],
          amount: pageData.Amount.toString(),
          scheduleDate: new Date(pageData["Schedule Date"]),
          adminStatus: pageData["Admin Status"],
          operataStatus: pageData["Operata Status"]
        }
      });
    } else {
      // Create new transaction
      await prisma.scheduledTransaction.create({
        data: {
          notionPageId: pageId,
          walletId,
          transactionName: pageData["Transaction Name"],
          toAddress: pageData["To Address"],
          amount: pageData.Amount.toString(),
          scheduleDate: new Date(pageData["Schedule Date"]),
          adminStatus: pageData["Admin Status"],
          operataStatus: "PENDING"
        }
      });
    }
  }

  private async handleTransactionWebhook(walletId: string, pageId: string, pageData: any) {
    const existingTransaction = await prisma.transaction.findFirst({
      where: { notionPageId: pageId }
    });

    if (existingTransaction) {
      await prisma.transaction.update({
        where: { id: existingTransaction.id },
        data: {
          hash: pageData["Transaction Hash"] || "",
          from: pageData.From,
          to: pageData.To,
          value: pageData.Amount.toString(),
          status: pageData.Status
        }
      });
    } else {
      await prisma.transaction.create({
        data: {
          notionPageId: pageId,
          walletId,
          hash: pageData["Transaction Hash"] || "",
          from: pageData.From,
          to: pageData.To,
          value: pageData.Amount.toString(),
          status: pageData.Status
        }
      });
    }
  }

  private async handleNFTWebhook(walletId: string, pageId: string, pageData: any) {
    const existingNFT = await prisma.nFT.findUnique({
      where: { notionPageId: pageId }
    });

    if (existingNFT) {
      await prisma.nFT.update({
        where: { notionPageId: pageId },
        data: {
          name: pageData.Name,
          tokenId: pageData["Token ID"].toString(),
          contractAddress: pageData["Contract Address"],
          attributes: pageData.Attributes ? JSON.parse(pageData.Attributes) : null,
          description: pageData.Description,
          imageUrl: pageData["Image URL"],
          receiveDate: pageData["Receive Date"] ? new Date(pageData["Receive Date"]) : null,
          transactionHash: pageData["Transaction Hash"]
        }
      });
    } else {
      await prisma.nFT.create({
        data: {
          notionPageId: pageId,
          walletId,
          name: pageData.Name,
          tokenId: pageData["Token ID"].toString(),
          contractAddress: pageData["Contract Address"],
          attributes: pageData.Attributes ? JSON.parse(pageData.Attributes) : null,
          description: pageData.Description,
          imageUrl: pageData["Image URL"],
          receiveDate: pageData["Receive Date"] ? new Date(pageData["Receive Date"]) : null,
          transactionHash: pageData["Transaction Hash"]
        }
      });
    }
  }

  private async handleReceivedTransactionWebhook(walletId: string, pageId: string, pageData: any) {
    const existingTransaction = await prisma.receivedTransaction.findUnique({
      where: { notionPageId: pageId }
    });

    if (existingTransaction) {
      await prisma.receivedTransaction.update({
        where: { notionPageId: pageId },
        data: {
          fromAddress: pageData["From Address"],
          amount: pageData.Amount.toString(),
          tokenName: pageData["Token Name"],
          transactionHash: pageData["Transaction Hash"],
          date: new Date(pageData.Date),
          status: pageData.Status
        }
      });
    } else {
      await prisma.receivedTransaction.create({
        data: {
          notionPageId: pageId,
          walletId,
          fromAddress: pageData["From Address"],
          amount: pageData.Amount.toString(),
          tokenName: pageData["Token Name"],
          transactionHash: pageData["Transaction Hash"],
          date: new Date(pageData.Date),
          status: pageData.Status
        }
      });
    }
  }

  private parseNotionPage(page: any) {
    if (!this.isPageObjectResponse(page)) {
      throw new Error("Invalid page response");
    }

    const properties = page.properties;
    const result: any = {};

    for (const [key, value] of Object.entries(properties)) {
      result[key] = this.parseNotionProperty(value as any);
    }

    return result;
  }

  private parseNotionProperty(property: any): any {
    switch (property.type) {
      case "title":
        return property.title[0]?.plain_text || "";
      case "rich_text":
        return property.rich_text[0]?.plain_text || "";
      case "number":
        return property.number;
      case "select":
        return property.select?.name;
      case "multi_select":
        return property.multi_select.map((item: any) => item.name);
      case "date":
        return property.date?.start;
      case "url":
        return property.url;
      case "checkbox":
        return property.checkbox;
      default:
        return null;
    }
  }

  private convertValueToNotionProperty(value: any): any {
    if (typeof value === "string") {
      return { rich_text: [{ text: { content: value } }] };
    } else if (typeof value === "number") {
      return { number: value };
    } else if (value instanceof Date) {
      return { date: { start: value.toISOString() } };
    } else if (typeof value === "boolean") {
      return { checkbox: value };
    } else if (Array.isArray(value)) {
      return { multi_select: value.map(v => ({ name: v })) };
    } else if (typeof value === "object" && value !== null) {
      return { select: { name: value } };
    }
    return null;
  }

  async syncWalletBalances(workspaceId: string): Promise<void> {
    try {
      const wallets = await prisma.wallet.findMany({
        where: { workspaceId }
      });

      const suiWalletService = new SuiWalletService();

      for (const wallet of wallets) {
        try {
          // Skip if no notion page ID
          if (!wallet.notionPageId) {
            Logger.warn('NotionService', 'Wallet has no notion page ID', { walletId: wallet.id });
            continue;
          }

          // Get wallet balance from SUI
          const balance = await suiWalletService.getBalance(wallet.id);
          // Convert MIST to SUI (1 SUI = 10^9 MIST)
          const balanceInSui = (Number(balance) / 1e9).toFixed(4);
          Logger.info('NotionService', 'Got wallet balance', { walletId: wallet.id, balance: balanceInSui });

          // Get all blocks in the wallet's Notion page
          const blocks = await this.client.blocks.children.list({
            block_id: wallet.notionPageId
          });

          // Log all blocks for debugging
          // Logger.info('NotionService', 'Found blocks in page', {
          //   walletId: wallet.id,
          //   blockCount: blocks.results.length,
          //   blocks: blocks.results.map(block => ({
          //     type: 'type' in block ? block.type : 'unknown',
          //     id: block.id
          //   }))
          // });

          // Find the column list block
          const columnList = blocks.results.find(block => 
            'type' in block && 
            block.type === 'column_list'
          );

          if (!columnList) {
            Logger.warn('NotionService', 'Column list not found', { walletId: wallet.id });
            continue;
          }

          // Get the columns
          const columns = await this.client.blocks.children.list({
            block_id: columnList.id
          });

          // The right column should be the second column
          const rightColumn = columns.results[1];
          if (!rightColumn || !('type' in rightColumn) || rightColumn.type !== 'column') {
            Logger.warn('NotionService', 'Right column not found', { walletId: wallet.id });
            continue;
          }

          // Get blocks in the right column
          const rightColumnBlocks = await this.client.blocks.children.list({
            block_id: rightColumn.id
          });

          // Find the Portfolio Overview section in the right column
          const portfolioSection = rightColumnBlocks.results.find(block => 
            'type' in block && 
            block.type === 'callout' && 
            'rich_text' in block.callout && 
            block.callout.rich_text.some(text => 
              text.plain_text === 'Portfolio Overview'
            )
          );

          if (!portfolioSection) {
            Logger.warn('NotionService', 'Portfolio Overview section not found', { walletId: wallet.id });
            continue;
          }

          // Find the column list after the Portfolio Overview section
          const portfolioIndex = rightColumnBlocks.results.indexOf(portfolioSection);
          const balanceColumnList = rightColumnBlocks.results[portfolioIndex + 1];

          if (!balanceColumnList || !('type' in balanceColumnList) || balanceColumnList.type !== 'column_list') {
            Logger.warn('NotionService', 'Balance column list not found after Portfolio Overview', { walletId: wallet.id });
            continue;
          }

          // Get the balance columns
          const balanceColumns = await this.client.blocks.children.list({
            block_id: balanceColumnList.id
          });

          // Find the SUI balance column (first column)
          const suiBalanceColumn = balanceColumns.results[0];
          if (!suiBalanceColumn || !('type' in suiBalanceColumn) || suiBalanceColumn.type !== 'column') {
            Logger.warn('NotionService', 'SUI balance column not found', { walletId: wallet.id });
            continue;
          }

          // Get the callout block in the SUI balance column
          const suiBalanceCallout = await this.client.blocks.children.list({
            block_id: suiBalanceColumn.id
          });

          if (!suiBalanceCallout.results[0] || !('type' in suiBalanceCallout.results[0]) || suiBalanceCallout.results[0].type !== 'callout') {
            Logger.warn('NotionService', 'SUI balance callout not found', { walletId: wallet.id });
            continue;
          }

          // Update the SUI balance
          await this.client.blocks.update({
            block_id: suiBalanceCallout.results[0].id,
            callout: {
              rich_text: [{ type: 'text', text: { content: `SUI Balance\n${balanceInSui}` } }],
              color: 'blue_background',
              icon: { emoji: '💰' }
            }
          });

          Logger.info('NotionService', 'Updated SUI balance in Notion', { walletId: wallet.id, balance: balanceInSui });
        } catch (error) {
          Logger.error('NotionService', 'Error syncing wallet balance', { walletId: wallet.id, error });
        }
      }
    } catch (error) {
      Logger.error('NotionService', 'Error in syncWalletBalances', { error });
      throw error;
    }
  }
}