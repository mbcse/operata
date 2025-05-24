# Character Generation Tools

This document explains how to use the character generation tools for the Eliza Generator Agent.

## Overview

The tools system provides specialized tools for generating character files using Zod schemas. This ensures that the LLM generates correct character data that conforms to the required structure.

## Available Tools

The following tools are available:

1. **generate_character_file**: Generates a character file using the schema structure
2. **get_character_schema**: Returns the character schema as a string to help the LLM understand the required structure

## How to Use the Tools

### Generating a Character File

To generate a character file, use the `generate_character_file` tool:

```typescript
// Example of using the generate_character_file tool
const characterData = {
  name: "Eliza",
  bio: ["AI assistant", "Helpful and friendly"],
  lore: ["Created in 2023", "Designed to assist users with various tasks"],
  topics: ["AI", "Technology", "Assistance"],
  adjectives: ["Helpful", "Friendly", "Intelligent"],
  style: {
    all: ["Clear", "Concise"],
    chat: ["Conversational", "Engaging"],
    post: ["Informative", "Professional"]
  },
  modelProvider: "OPENAI" // Optional, defaults to OPENAI
};

// The LLM can call this tool to generate a valid character file
const result = await generate_character_file(characterData);
```

The tool will:
1. Create a character object using the provided data
2. Validate it against the character schema
3. Return the validated data if successful
4. Return detailed error messages if validation fails

### Getting the Character Schema

To get the character schema, use the `get_character_schema` tool:

```typescript
// The LLM can call this tool to get the schema
const schema = await get_character_schema({});
```

This will return the character schema as a string, which helps the LLM understand the required structure for character files.

## How Tools Are Bound to the LLM

Tools are automatically bound to the LLM when it's created through the `LLMModelManager`. The `ElizaGeneratorAgent` enables tools by default.

## Enabling/Disabling Tools

You can enable or disable tools when creating an LLM model:

```typescript
// Enable tools (default for ElizaGeneratorAgent)
const modelConfigWithTools: LLLModelConfig = {
  provider: LLMProviders.OPENAI,
  apiKey: "your-api-key",
  modelName: "gpt-4",
  enableTools: true
};

// Disable tools
const modelConfigWithoutTools: LLLModelConfig = {
  provider: LLMProviders.OPENAI,
  apiKey: "your-api-key",
  modelName: "gpt-4",
  enableTools: false
};

const llm = LLMModelManager.getInstance(modelConfigWithTools);
```

You can also enable or disable tools after creating the model:

```typescript
const llm = LLMModelManager.getInstance(modelConfig);

// Enable tools
llm.enableTools();

// Disable tools
llm.disableTools();

// Check if tools are enabled
if (llm.areToolsEnabled()) {
  console.log("Tools are enabled");
}
```

## Implementation Details

The character generation tools use the Zod schema defined in `characterConfig.ts`. This schema specifies the required structure for character files, including:

- Required fields
- Field types
- Nested objects
- Arrays
- Optional fields

When the LLM generates a character file, it uses these tools to ensure that the generated data conforms to the required schema. This helps prevent errors and ensures that the character files are correctly structured.

## Benefits of Using Zod Schema Directly

By using the Zod schema directly as input to the tool:

1. **Type Safety**: The tool accepts structured input that matches the schema
2. **Validation**: The input is validated against the schema before being used
3. **Simplicity**: The LLM doesn't need to generate JSON directly, just provide the required fields
4. **Error Prevention**: Common errors like missing required fields are caught early

## How It Works

Under the hood, the tools system uses LangChain's tool framework. When a model is created through the `LLMModelManager`, the tools are automatically bound to the model if tools are enabled.

For OpenAI models, the tools are bound using the `bind({ tools: agentTools })` method. For other models, different approaches may be needed, which can be implemented in the `bindToolsToModel` function in `AgentTools.ts`. 