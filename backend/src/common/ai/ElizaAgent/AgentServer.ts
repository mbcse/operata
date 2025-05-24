import { StructuredOutputParser } from '@langchain/core/output_parsers';
import { OutputFixingParser } from "langchain/output_parsers";

import { HumanMessage } from "@langchain/core/messages";
import { P } from "pino";
import { LLLModelConfig, LLMModelManager, LLMProviders } from "../LLMModelManager";
import { EmbeddingConfig, EmbeddingManager, EmbeddingProvider } from "../EmbeddingManager";
import { VectorStoreConfig, VectorStoreManager } from "../VectorStoreManager";
import { RunnableSequence } from "@langchain/core/runnables";
import { elizaCharacterGeneratorSystemPrompt } from "../systemPromtTemplates/elizaCharacterGeneratorSystemPromt";
import { elizaReplyGeneratorSystemPrompt } from "../systemPromtTemplates/elizaReplyGeneratorSystemPrompt";
import { z } from "zod";
import { characterJsonSchema, CharacterSchema } from "./characterConfig";
import { IterableReadableStream } from '@langchain/core/utils/stream';
import { DatabaseService } from '../../../database';
import { StringOutputParser } from "@langchain/core/output_parsers";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { Logger } from "../../utils/logger";


export class ElizaGeneratorAgent {
  private llm: LLMModelManager;
  private embedder: EmbeddingManager;
  private vectorStore: VectorStoreManager;
  private db: DatabaseService;

  private constructor(modelConfig: LLLModelConfig, embeddingConfig: EmbeddingConfig, vectorStoreConfig: VectorStoreConfig) {
    // Enable tools by default for the LLM
    const configWithTools: LLLModelConfig = {
      ...modelConfig,
      enableTools: false
    };
    
    const initTimer = Logger.time('AGENT_INIT', 'Initialize ElizaGeneratorAgent components');
    
    this.llm = LLMModelManager.getInstance(configWithTools);
    this.embedder = EmbeddingManager.getInstance(embeddingConfig);
    this.vectorStore = new VectorStoreManager(vectorStoreConfig, this.embedder.getEmbedder());
    this.db = DatabaseService.getInstance();
    
    initTimer.success(`ElizaGeneratorAgent created with tools ${this.llm.areToolsEnabled() ? 'enabled' : 'disabled'}`);
  }

  /**
   * Create a new agent instance
   * @param modelConfig LLM model configuration
   * @param embeddingConfig Embedding configuration
   * @param vectorStoreConfig Vector store configuration
   * @returns New agent instance
   */
  public static async create(modelConfig: LLLModelConfig, embeddingConfig: EmbeddingConfig, vectorStoreConfig: VectorStoreConfig): Promise<ElizaGeneratorAgent> {
    const createTimer = Logger.time('AGENT_CREATE', 'Creating new ElizaGeneratorAgent', {
      modelProvider: modelConfig.provider,
      modelName: modelConfig.modelName,
      embeddingProvider: embeddingConfig.provider
    });
    
    const agent = new ElizaGeneratorAgent(modelConfig, embeddingConfig, vectorStoreConfig);
    createTimer.success('Agent creation completed');
    
    return agent;
  }

  /**
   * Initialize the agent and prepare session data
   * @param sessionId Unique session identifier
   * @param userMessage The user's message
   * @returns Object containing message history, context, and character file
   */
  public async initializeSession(sessionId: string, userMessage: string): Promise<{ messageHistory: string, context: string, sessionId: string, characterFile: any }> {
    const sessionTimer = Logger.time('AGENT_SESSION', `Initialize session ${sessionId}`, { 
      sessionId, 
      messageLength: userMessage.length 
    });
    
    try {
      // Initialize vector store
      const vectorStoreTimer = Logger.time('AGENT_SESSION', 'Initialize vector store');
      await this.vectorStore.init();
      vectorStoreTimer.success('Vector store initialized successfully');
      
      // Ensure database connection and get/create session
      const dbTimer = Logger.time('AGENT_SESSION', 'Database connection');
      await this.db.connect();
      
      // Get or create session
      let session = await this.db.sessions.getSessionById(sessionId);
      if (!session) {
        session = await this.db.sessions.createSession();
        dbTimer.success('New session created', { sessionId: session.id });
      } else {
        dbTimer.success('Using existing session', { sessionId: session.id });
      }
      
      // Store message in database
      const storeMessageTimer = Logger.time('AGENT_SESSION', 'Store user message');
      await this.db.messages.createMessage({
        content: '',
        role: 'user',
        sessionId: session.id,
      });
      storeMessageTimer.success('User message stored', { sessionId: session.id });

      // Fetch relevant context from vector store
      const contextTimer = Logger.time('AGENT_SESSION', 'Retrieve context from vector store');
      const relevantDocs = await this.vectorStore.getVectorStore().similaritySearch(userMessage, 3);
      
      const context = relevantDocs.map(doc => doc.pageContent).join('\n');
      const contextInfo: Record<string, any> = { 
        documentsFound: relevantDocs.length, 
        contextLength: context.length 
      };
      
      if (relevantDocs.length > 0) {
        contextInfo['firstDocumentMetadata'] = relevantDocs[0].metadata;
      }
      
      contextTimer.success('Context retrieved', contextInfo);

      // Create message history string from database
      const historyTimer = Logger.time('AGENT_SESSION', 'Build message history');
      const dbMessages = await this.db.messages.getMessagesBySessionId(session.id);
      
      
      const previousMessages = dbMessages.slice(0, dbMessages.length);
      
      // Format message history as "User Message: content" or "Assistant Message: content"
      const messageHistory = previousMessages.map(msg => {
        const roleLabel = msg.role === 'user' ? 'User Message' : 'Assistant Message';
        return `${roleLabel}: ${msg.content}`;
      }).join('\n');
      
      historyTimer.success('Message history built', { 
        messageCount: previousMessages.length,
        historyLength: messageHistory.length 
      });

      // Fetch current character file from database
      const characterTimer = Logger.time('AGENT_SESSION', 'Retrieve character file');
      const characterFileRecord = await this.db.characterFiles.getCharacterFileBySessionId(session.id);
      let characterFile: any = null;
      
      if (!characterFileRecord) {
        characterFile = {
          name: "",
          bio: [],
          lore: [],
          knowledge: [],
          messageExamples: [],
          postExamples: [],
          topics: [],
          style: {
            all: [],
            chat: [],
            post: []
          },
          adjectives: [],
          clients: [],
          plugins: [],
          modelProvider: "",
          settings: {
            secrets: {},
            voice: {
              model: "en_US-male-medium"
            }
          }
        };
        characterTimer.success('Created empty character file template');
      } else {
        // If we have a record, extract its content
        if (typeof characterFileRecord.content === 'string') {
          // If content is a string, try to parse it as JSON
          try {
            characterFile = JSON.parse(characterFileRecord.content);
            characterTimer.success('Parsed character file from JSON string', {
              hasName: !!characterFile?.name,
              bioCount: characterFile?.bio?.length || 0,
              knowledgeCount: characterFile?.knowledge?.length || 0
            });
          } catch (e) {
            characterFile = {}; // Fallback to empty object
            characterTimer.error('Failed to parse character file content as JSON', e);
          }
        } else {
          // Otherwise, use the content directly
          characterFile = characterFileRecord.content;
          characterTimer.success('Retrieved character file object', {
            hasName: !!characterFile?.name,
            bioCount: characterFile?.bio?.length || 0,
            knowledgeCount: characterFile?.knowledge?.length || 0
          });
        }
      }

      sessionTimer.success('Session initialization complete', { sessionId: session.id });
      return { messageHistory, context, sessionId: session.id, characterFile };
    } catch (error) {
      sessionTimer.error('Exception in initializeSession', error);
      throw error;
    }
  }

  /**
   * Generate a conversational reply to the user's message
   * @param sessionId Unique session identifier
   * @param userMessage The user's message
   * @param messageHistory Previous conversation history
   * @param context Relevant context from vector store
   * @param characterFile Current character file
   * @returns Stream of reply chunks
   */
  public async generateReply(sessionId: string, userMessage: string, messageHistory: string, context: string, characterFile: any): Promise<IterableReadableStream<any>> {
    const replyTimer = Logger.time('AGENT_REPLY', `Generate reply for session ${sessionId}`, {
      sessionId,
      messageHistoryLength: messageHistory.length,
      contextLength: context.length,
      hasCharacterFile: !!characterFile
    });
    
    try {
      // Create a parser for the reply
      const ReplySchema = z.object({
        reply: z.string()
      });
      
      const parserTimer = Logger.time('AGENT_REPLY', 'Create reply parser and chain');
      const replyParser = StructuredOutputParser.fromZodSchema(ReplySchema);
      
      // Create the reply chain
      const replyChain = RunnableSequence.from([
        {
          messageHistory: (input) => messageHistory,
          context: (input) => context,
          characterFile: (input) => JSON.stringify(characterFile, null, 2),
          formatInstructions: (input) => replyParser.getFormatInstructions(),
        },
        elizaReplyGeneratorSystemPrompt,
        this.llm.getModel(),
        replyParser
      ]);
      parserTimer.success('Reply parser and chain created');
      
      const streamTimer = Logger.time('AGENT_REPLY', 'Initialize reply stream');
      const stream = await replyChain.stream(userMessage);
      streamTimer.success('Reply stream created');
      
      replyTimer.success('Reply generation setup completed');
      return stream;
    } catch (error) {
      replyTimer.error('Error in reply generation', error);
      throw error;
    }
  }
  
  /**
   * Generate a character file based on the conversation
   * @param sessionId Unique session identifier
   * @param userMessage The user's message
   * @param messageHistory Previous conversation history
   * @param context Relevant context from vector store
   * @param characterFile Current character file
   * @returns Stream of character file chunks
   */
  public async generateCharacterFile(sessionId: string, userMessage: string, messageHistory: string, context: string, characterFile: any): Promise<IterableReadableStream<any>> {
    const characterTimer = Logger.time('AGENT_CHARACTER', `Generate character file for session ${sessionId}`, {
      sessionId,
      messageHistoryLength: messageHistory.length,
      contextLength: context.length,
      hasExistingCharacterFile: !!characterFile?.name
    });
    
    try {
      // Create a parser for the character file
      const parserTimer = Logger.time('AGENT_CHARACTER', 'Create character file parser');
      const parser = StructuredOutputParser.fromZodSchema(CharacterSchema);
      
      // Create an output fixing parser to handle potential parsing errors
      const fixingParser = OutputFixingParser.fromLLM(
        this.llm.getModel(),
        parser
      );
      parserTimer.success('Character file parser created');
      
      // Create a JSON validator prompt
      const promptTimer = Logger.time('AGENT_CHARACTER', 'Create character file prompt and chain');
      const jsonValidatorPrompt = ChatPromptTemplate.fromTemplate(`
        You are a JSON validator and repair expert. Your task is to validate and fix the following JSON object 
        to ensure it conforms to the required schema for a character file.
        
        Here is the JSON schema that the object should conform to:
        {characterJsonSchema}
        
        Here is the JSON object to validate and fix:
        {jsonObject}
        
        If the JSON is valid and conforms to the schema, return it unchanged.
        If the JSON has syntax errors or doesn't conform to the schema, fix it and return the corrected version.
        
        Return ONLY the fixed JSON object, with no additional explanation or commentary.
        The output must be valid JSON that can be parsed with JSON.parse().
      `);
      
      // Create a JSON validator function
      const validateJson = async (characterData: any) => {
        const validationTimer = Logger.time('AGENT_CHARACTER', 'Validating JSON');
        
        const jsonString = JSON.stringify(characterData, null, 2);
        
        const jsonValidatorChain = RunnableSequence.from([
          {
            characterJsonSchema: () => characterJsonSchema,
            jsonObject: () => jsonString
          },
          jsonValidatorPrompt,
          this.llm.getModel(),
          new StringOutputParser()
        ]);
        
        try {
          const validatedJsonString = await jsonValidatorChain.invoke({});
          
          // Parse the validated JSON
          const validatedJson = JSON.parse(validatedJsonString);
          validationTimer.success('JSON validation complete and successful');
          return validatedJson;
        } catch (parseError) {
          validationTimer.error('Failed to parse validated JSON', parseError);
          // If we can't parse it, return the original
          return characterData;
        }
      };
      
      // Create the character file chain with validation
      const characterChain = RunnableSequence.from([
        {
          messageHistory: (input) => messageHistory,
          context: (input) => context,
          characterFile: (input) => JSON.stringify(characterFile, null, 2),
          characterJsonSchema: (input) => characterJsonSchema,
          formatInstructions: (input) => parser.getFormatInstructions(),
        },
        elizaCharacterGeneratorSystemPrompt,
        this.llm.getModel(),
        // new StringOutputParser(),
        // {
        //   characterJsonSchema: () => characterJsonSchema,
        //   jsonObject: (output) => JSON.stringify(output, null, 2)
        // },
        // jsonValidatorPrompt,
        // this.llm.getModel(),
        new StringOutputParser()
      ]);
      promptTimer.success('Character chain created with validation');
      
      const streamTimer = Logger.time('AGENT_CHARACTER', 'Initialize character file stream');
      const stream = await characterChain.stream(userMessage);
      streamTimer.success('Character file stream created successfully', {
        sessionId,
        streamType: typeof stream
      });
      
      characterTimer.success('Character file generation setup completed');
      return stream;
    } catch (error) {
      characterTimer.error('Error setting up character file generation', error);
      throw error;
    }
  }

  /**
   * Add debug logging to a stream
   * @param stream Input stream
   * @param prefix Log prefix
   * @returns Stream with logging
   */
  private async *addStreamLogging<T>(stream: AsyncIterable<T>, prefix: string): AsyncGenerator<T> {
    let count = 0;
    for await (const chunk of stream) {
      count++;
      Logger.info('AGENT_STREAM', `${prefix} Chunk ${count}:`, chunk);
      yield chunk;
    }
    Logger.info('AGENT_STREAM', `${prefix} Stream complete. Total chunks: ${count}`);
  }
}