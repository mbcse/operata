import { jsonrepair } from 'jsonrepair';
import { CharacterData, ExtractedData } from '../types/agent';

// Extract message and JSON from content
export const extractJsonAndMessage = (content: string): ExtractedData => {
  try {
    // First try to parse as complete JSON
    const parsed = JSON.parse(content);
    if (parsed.message && parsed.characterFileJson) {
      return { message: parsed.message, json: parsed.characterFileJson };
    }
  } catch (e) {
    console.log('Initial parse failed:', e);

    // Try to extract just the message if JSON parse fails
    try {
      // Look for message field with various possible formats
      const messagePatterns = [
        /"message":\s*"((?:[^"\\]|\\.)*)"/,  // Standard JSON format
        /message":\s*"([^"]+)"/,              // Less strict format
        /"message":\s*"([\s\S]*?)(?:"|$)/     // Very lenient format
      ];

      for (const pattern of messagePatterns) {
        const match = content.match(pattern);
        if (match && match[1]) {
          // Found a message, try to find accompanying JSON
          try {
            const jsonRegex = /"characterFileJson"\s*:\s*({[\s\S]*?})(?=\s*[,}]|$)/;
            const jsonMatch = content.match(jsonRegex);
            const json = jsonMatch ? JSON.parse(jsonMatch[1]) : null;
            
            return {
              message: match[1].replace(/\\"/g, '"').replace(/\\n/g, '\n'),
              json: json
            };
          } catch (jsonError) {
            // If JSON extraction fails, return just the message
            return {
              message: match[1].replace(/\\"/g, '"').replace(/\\n/g, '\n'),
              json: null
            };
          }
        }
      }
    } catch (extractError) {
      console.log('Message extraction failed:', extractError);
    }

    // If no message found, try to clean up the content
    if (typeof content === 'string') {
      // Remove markdown code blocks if present
      const cleanContent = content.replace(/```json\n[\s\S]*?\n```/g, '').trim();
      
      // If content looks like a message, return it
      if (cleanContent.length > 0 && cleanContent.length < 1000) {
        return {
          message: cleanContent,
          json: null
        };
      }
    }
  }

  // Fallback to returning the raw content
  return {
    message: typeof content === 'string' ? content : 'Invalid content',
    json: null
  };
};

// Create empty character data template
export const getEmptyCharacterData = (): CharacterData => {
  return {
    name: "",
    bio: "",
    lore: "",
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
    settings: {}
  };
}; 