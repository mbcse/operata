// Define types for agent data
export interface StyleData {
  all: string[];
  chat: string[];
  post: string[];
}

export interface CharacterData {
  name: string;
  bio: string | string[];
  lore: string | string[];
  knowledge: string[];
  messageExamples: any[];
  postExamples: string[];
  topics: string[];
  style: StyleData;
  adjectives: string[];
  clients: string[];
  plugins: string[];
  settings: {
    secrets?: Record<string, string>;
    [key: string]: any;
  };
  twitterProfile?: {
    id?: string;
    username?: string;
    screenName?: string;
    bio?: string;
    nicknames?: string[];
    [key: string]: any;
  };
  modelProvider?: string;
  _rawContent?: string; // For storing raw JSON fragments during assembly
  [key: string]: any; // Add index signature to allow dynamic access
}

// Define the return type for extraction function
export interface ExtractedData {
  message: string;
  json: CharacterData | null;
}

// Define types for streaming chunks
export interface StreamChunk {
  type: 'reply' | 'characterFile' | 'error';
  content: any;
  errorType?: string;
  error?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
} 