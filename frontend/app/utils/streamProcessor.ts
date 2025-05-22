import { jsonrepair } from 'jsonrepair';
import { CharacterData, StreamChunk } from '../types/agent';

/**
 * Process a stream chunk for character file data
 */
export const processCharacterFileChunk = (
  chunk: StreamChunk, 
  setStreamingCharacterFile: React.Dispatch<React.SetStateAction<Partial<CharacterData>>>,
  setIsStreamingCharacterFile: React.Dispatch<React.SetStateAction<boolean>>
) => {
  // For character file chunks, we need to accumulate and parse JSON data
  if (typeof chunk.content === 'string') {
    // Try to parse the string content if it looks like JSON
    if (chunk.content.trim().startsWith('{') && chunk.content.trim().endsWith('}')) {
      try {
        const parsedData = JSON.parse(chunk.content);
        setStreamingCharacterFile(prev => ({
          ...prev,
          ...parsedData,
          // Keep any raw content we've been accumulating
          _rawContent: (prev._rawContent || '') + chunk.content
        }));
        setIsStreamingCharacterFile(true);
        return;
      } catch (e) {
        // Not valid JSON, accumulate as raw content
        console.log("Incomplete JSON fragment:", chunk.content);
      }
    }
    
    // If we're here, treat it as a raw fragment
    setStreamingCharacterFile(prev => {
      const existingRaw = prev._rawContent || '';
      const newRaw = existingRaw + chunk.content;
      
      // Try to repair and parse the accumulated content
      try {
        const repairedJson = jsonrepair(newRaw);
        const parsedData = JSON.parse(repairedJson);
        
        // If parsing succeeded, update with parsed data but keep raw content
        return { ...prev, ...parsedData, _rawContent: newRaw };
      } catch (e) {
        // Still not valid JSON, just update raw content
        return { ...prev, _rawContent: newRaw };
      }
    });
    
    setIsStreamingCharacterFile(true);
  } 
  else if (typeof chunk.content === 'object' && chunk.content !== null) {
    // If the backend sends a complete object, use it directly
    setStreamingCharacterFile(prev => {
      // Keep any raw content we've been accumulating
      const rawContent = prev._rawContent || '';
      return { ...prev, ...chunk.content, _rawContent: rawContent };
    });
    
    setIsStreamingCharacterFile(true);
  }
};

/**
 * Process text-based character data into a JSON object
 */
export const extractCharacterData = (text: string): Partial<CharacterData> | null => {
  try {
    // Try to extract JSON from the content
    const jsonRegex = /"characterFileJson"\s*:\s*({[\s\S]*?})(?=\s*[,}]|$)/;
    const jsonMatch = text.match(jsonRegex);
    
    if (jsonMatch && jsonMatch[1]) {
      // Try to parse the JSON
      const repairedJson = jsonrepair(jsonMatch[1]);
      return JSON.parse(repairedJson);
    }
    
    // If no characterFileJson found, check if the entire text is valid JSON
    if (text.trim().startsWith('{') && text.trim().endsWith('}')) {
      try {
        return JSON.parse(text);
      } catch (e) {
        // Not valid JSON
        return null;
      }
    }
    
    return null;
  } catch (e) {
    console.error("Error extracting character data:", e);
    return null;
  }
}; 