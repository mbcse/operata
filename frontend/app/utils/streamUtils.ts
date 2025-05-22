import { Lexer } from 'streaming-json';
import { jsonrepair } from 'jsonrepair';
import { CharacterData } from '../types/agent';

/**
 * Helper class for handling streaming JSON fragments
 * Uses streaming-json library to complete partial JSON
 */
export class JsonStreamHandler {
  private lexer: Lexer;
  private rawContent: string = '';
  private lastParsedData: Partial<CharacterData> = {};

  constructor() {
    this.lexer = new Lexer();
    console.log("JsonStreamHandler initialized");
  }

  /**
   * Processes a new JSON fragment and returns the completed JSON object
   * @param jsonFragment The JSON fragment string to process
   * @returns The parsed CharacterData object (partial)
   */
  processFragment(jsonFragment: string): Partial<CharacterData> {
    try {
      // Append to the raw content
      this.rawContent += jsonFragment;
      console.log("Raw content updated, length:", this.rawContent.length);
      
      // Append the fragment to the lexer
      this.lexer.AppendString(jsonFragment);
      
      // Try to complete the JSON
      let completedJson: string;
      try {
        completedJson = this.lexer.CompleteJSON();
        console.log("JSON completed by lexer:", completedJson.substring(0, 100) + "...");
      } catch (lexerError) {
        console.error("Lexer failed to complete JSON:", lexerError);
        // Try repairing the JSON directly as a fallback
        completedJson = jsonrepair(this.rawContent);
        console.log("JSON repaired as fallback:", completedJson.substring(0, 100) + "...");
      }
      
      if (!completedJson) {
        console.log("No completed JSON returned");
        return { ...this.lastParsedData, _rawContent: this.rawContent };
      }

      try {
        // Try parsing directly first
        const parsedData = JSON.parse(completedJson);
        console.log("Successfully parsed JSON:", Object.keys(parsedData));
        this.lastParsedData = { ...this.lastParsedData, ...parsedData };
        return { ...this.lastParsedData, _rawContent: this.rawContent };
      } catch (parseError) {
        console.error("Direct parsing failed, trying with jsonrepair:", parseError);
        
        // If direct parsing fails, try with jsonrepair as a backup
        try {
          const repairedJson = jsonrepair(completedJson);
          const parsedData = JSON.parse(repairedJson);
          console.log("Successfully parsed repaired JSON:", Object.keys(parsedData));
          this.lastParsedData = { ...this.lastParsedData, ...parsedData };
          return { ...this.lastParsedData, _rawContent: this.rawContent };
        } catch (repairError) {
          console.error("JSON repair also failed:", repairError);
          // If all parsing attempts fail, at least return what we have so far with raw content
          return { ...this.lastParsedData, _rawContent: this.rawContent };
        }
      }
    } catch (e) {
      console.error("Error processing JSON fragment:", e);
      return { ...this.lastParsedData, _rawContent: this.rawContent };
    }
  }

  /**
   * Extract JSON data from a string that contains a characterFileJson property
   * @param content The string containing the characterFileJson property
   * @returns The parsed CharacterData object or null
   */
  extractCharacterFileJson(content: string): Partial<CharacterData> | null {
    try {
      console.log("Attempting to extract characterFileJson from content:", content.substring(0, 100) + "...");
      
      // Try several regex patterns to extract the JSON
      const patterns = [
        /"characterFileJson"\s*:\s*({[\s\S]*?})(?=\s*[,}]|$)/,
        /characterFileJson\s*:\s*({[\s\S]*?})(?=\s*[,}]|$)/,
        /{[\s\S]*?}/
      ];
      
      for (const pattern of patterns) {
        const jsonMatch = content.match(pattern);
        if (jsonMatch && jsonMatch[1]) {
          console.log("Found JSON match with pattern:", pattern);
          return this.processFragment(jsonMatch[1]);
        }
      }
      
      // If no pattern matches but content looks like JSON, try processing directly
      if (content.trim().startsWith('{') && content.trim().endsWith('}')) {
        console.log("Content appears to be direct JSON, processing entire content");
        return this.processFragment(content);
      }
    } catch (e) {
      console.error("Error extracting characterFileJson:", e);
    }
    
    console.log("No JSON structure found in content");
    return null;
  }

  /**
   * Get the final character data, removing the raw content
   */
  getFinalData(): Partial<CharacterData> {
    const finalData = { ...this.lastParsedData };
    if (finalData._rawContent) {
      delete finalData._rawContent;
    }
    console.log("Returning final data:", Object.keys(finalData));
    return finalData;
  }

  /**
   * Reset the handler for a new streaming session
   */
  reset(): void {
    this.lexer = new Lexer();
    this.rawContent = '';
    this.lastParsedData = {};
    console.log("JsonStreamHandler reset");
  }

  /**
   * Get the current raw content
   */
  getRawContent(): string {
    return this.rawContent;
  }
} 