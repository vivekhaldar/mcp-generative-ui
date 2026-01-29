// ABOUTME: Tests for UI generator with dual-standard support.
// ABOUTME: Verifies prompt selection, validation, and minimal UI generation per standard.

import { describe, it, expect } from "vitest";
import { createGenerator, type ToolDefinition } from "./generator.js";
import type { LLMClient } from "./llm.js";

const sampleTool: ToolDefinition = {
  name: "get_weather",
  description: "Get current weather for a city",
  inputSchema: {
    type: "object",
    properties: {
      city: { type: "string", description: "City name" },
    },
    required: ["city"],
  },
};

function fakeLLM(response: string): LLMClient {
  return {
    async generate(_system: string, _user: string): Promise<string> {
      return response;
    },
  };
}

// Captures the system prompt passed to the LLM
function capturingLLM(response: string): { llm: LLMClient; captured: { system: string; user: string }[] } {
  const captured: { system: string; user: string }[] = [];
  return {
    llm: {
      async generate(system: string, user: string): Promise<string> {
        captured.push({ system, user });
        return response;
      },
    },
    captured,
  };
}

describe("createGenerator with openai standard", () => {
  it("uses openai system prompt", async () => {
    const { llm, captured } = capturingLLM('<html><body><script>window.openai.toolOutput</script></body></html>');
    const gen = createGenerator({ llm, standard: "openai" });
    await gen.generate(sampleTool);
    expect(captured[0].system).toContain("window.openai");
    expect(captured[0].system).not.toContain("@modelcontextprotocol/ext-apps");
  });

  it("validates generated HTML contains window.openai", async () => {
    const llm = fakeLLM('<html><body><script>console.log("no marker")</script></body></html>');
    const gen = createGenerator({ llm, standard: "openai" });
    const result = await gen.generate(sampleTool);
    expect(result.isMinimal).toBe(true);
  });

  it("accepts valid openai HTML", async () => {
    const validHtml = '<html><body><script>window.openai.toolOutput</script></body></html>';
    const llm = fakeLLM(validHtml);
    const gen = createGenerator({ llm, standard: "openai" });
    const result = await gen.generate(sampleTool);
    expect(result.isMinimal).toBe(false);
    expect(result.html).toBe(validHtml);
  });

  it("generates openai-style minimal UI", async () => {
    const llm = fakeLLM("not html at all");
    const gen = createGenerator({ llm, standard: "openai" });
    const result = await gen.generate(sampleTool);
    expect(result.isMinimal).toBe(true);
    expect(result.html).toContain("window.openai");
    expect(result.html).toContain("openai:set-globals");
    expect(result.html).not.toContain("@modelcontextprotocol/ext-apps");
  });

  it("includes openai-specific output handling in user prompt", async () => {
    const { llm, captured } = capturingLLM('<html><body><script>window.openai.toolOutput</script></body></html>');
    const gen = createGenerator({ llm, standard: "openai" });
    await gen.generate(sampleTool);
    expect(captured[0].user).toContain("window.openai.toolOutput");
  });
});

describe("createGenerator with mcp-apps standard", () => {
  it("uses mcp-apps system prompt", async () => {
    const { llm, captured } = capturingLLM('<html><body><script type="module">import { App } from "@modelcontextprotocol/ext-apps";</script></body></html>');
    const gen = createGenerator({ llm, standard: "mcp-apps" });
    await gen.generate(sampleTool);
    expect(captured[0].system).toContain("@modelcontextprotocol/ext-apps");
    expect(captured[0].system).toContain("app.connect()");
    expect(captured[0].system).not.toContain("window.openai");
  });

  it("validates generated HTML contains ext-apps import", async () => {
    const llm = fakeLLM('<html><body><script>console.log("no marker")</script></body></html>');
    const gen = createGenerator({ llm, standard: "mcp-apps" });
    const result = await gen.generate(sampleTool);
    expect(result.isMinimal).toBe(true);
  });

  it("accepts valid mcp-apps HTML", async () => {
    const validHtml = '<html><body><script type="module">import { App } from "@modelcontextprotocol/ext-apps";</script></body></html>';
    const llm = fakeLLM(validHtml);
    const gen = createGenerator({ llm, standard: "mcp-apps" });
    const result = await gen.generate(sampleTool);
    expect(result.isMinimal).toBe(false);
    expect(result.html).toBe(validHtml);
  });

  it("generates mcp-apps-style minimal UI", async () => {
    const llm = fakeLLM("not html at all");
    const gen = createGenerator({ llm, standard: "mcp-apps" });
    const result = await gen.generate(sampleTool);
    expect(result.isMinimal).toBe(true);
    expect(result.html).toContain('@modelcontextprotocol/ext-apps');
    expect(result.html).toContain('app.connect()');
    expect(result.html).toContain('app.ontoolresult');
    expect(result.html).toContain('app.callServerTool');
    expect(result.html).toContain('<script type="module">');
    expect(result.html).not.toContain("window.openai");
  });

  it("includes mcp-apps-specific output handling in user prompt", async () => {
    const { llm, captured } = capturingLLM('<html><body><script type="module">import { App } from "@modelcontextprotocol/ext-apps";</script></body></html>');
    const gen = createGenerator({ llm, standard: "mcp-apps" });
    await gen.generate(sampleTool);
    expect(captured[0].user).toContain("app.ontoolresult");
  });
});

describe("createGenerator defaults to mcp-apps", () => {
  it("defaults to mcp-apps when no standard specified", async () => {
    const { llm, captured } = capturingLLM('<html><body><script type="module">import { App } from "@modelcontextprotocol/ext-apps";</script></body></html>');
    const gen = createGenerator({ llm });
    await gen.generate(sampleTool);
    expect(captured[0].system).toContain("@modelcontextprotocol/ext-apps");
  });
});

describe("minimal UI form generation", () => {
  const toolWithFields: ToolDefinition = {
    name: "test_tool",
    description: "A test tool",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Your name" },
        count: { type: "integer", description: "Count" },
        enabled: { type: "boolean", description: "Enable feature" },
        mode: { type: "string", enum: ["fast", "slow"] },
      },
      required: ["name"],
    },
  };

  it("openai minimal UI has form fields for all properties", async () => {
    const llm = fakeLLM("broken");
    const gen = createGenerator({ llm, standard: "openai" });
    const result = await gen.generate(toolWithFields);
    expect(result.isMinimal).toBe(true);
    expect(result.html).toContain('id="name"');
    expect(result.html).toContain('id="count"');
    expect(result.html).toContain('id="enabled"');
    expect(result.html).toContain('id="mode"');
    expect(result.html).toContain("fast");
    expect(result.html).toContain("slow");
  });

  it("mcp-apps minimal UI has form fields for all properties", async () => {
    const llm = fakeLLM("broken");
    const gen = createGenerator({ llm, standard: "mcp-apps" });
    const result = await gen.generate(toolWithFields);
    expect(result.isMinimal).toBe(true);
    expect(result.html).toContain('id="name"');
    expect(result.html).toContain('id="count"');
    expect(result.html).toContain('id="enabled"');
    expect(result.html).toContain('id="mode"');
    expect(result.html).toContain("fast");
    expect(result.html).toContain("slow");
  });
});

describe("strips markdown code fences", () => {
  it("strips ```html fences for openai", async () => {
    const llm = fakeLLM('```html\n<html><body><script>window.openai.toolOutput</script></body></html>\n```');
    const gen = createGenerator({ llm, standard: "openai" });
    const result = await gen.generate(sampleTool);
    expect(result.isMinimal).toBe(false);
    expect(result.html).not.toContain("```");
  });

  it("strips ```html fences for mcp-apps", async () => {
    const llm = fakeLLM('```html\n<html><body><script type="module">import { App } from "@modelcontextprotocol/ext-apps";</script></body></html>\n```');
    const gen = createGenerator({ llm, standard: "mcp-apps" });
    const result = await gen.generate(sampleTool);
    expect(result.isMinimal).toBe(false);
    expect(result.html).not.toContain("```");
  });
});
