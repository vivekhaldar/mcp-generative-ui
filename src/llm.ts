// ABOUTME: LLM integration using Vercel AI SDK for multi-provider support.
// ABOUTME: Provides unified interface for generating UI HTML from prompts.

import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { WrapperConfig } from "./config.js";

export interface LLMClient {
  generate(systemPrompt: string, userPrompt: string): Promise<string>;
}

export function createLLMClient(config: WrapperConfig["llm"]): LLMClient {
  const { provider, model, apiKey } = config;

  // Create the provider instance
  let providerInstance: ReturnType<typeof createAnthropic> | ReturnType<typeof createOpenAI>;
  let defaultModel: string;

  if (provider === "anthropic") {
    providerInstance = createAnthropic({ apiKey });
    defaultModel = "claude-sonnet-4-20250514";
  } else if (provider === "openai") {
    providerInstance = createOpenAI({ apiKey });
    defaultModel = "gpt-4o";
  } else {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  const modelId = model || defaultModel;

  return {
    async generate(systemPrompt: string, userPrompt: string): Promise<string> {
      const result = await generateText({
        model: providerInstance(modelId),
        system: systemPrompt,
        prompt: userPrompt,
        maxTokens: 8000,
        temperature: 0.2,
      });

      return result.text;
    },
  };
}
