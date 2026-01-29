// ABOUTME: Tests for standard profile abstraction.
// ABOUTME: Verifies OpenAI and MCP Apps profiles return correct values.

import { describe, it, expect } from "vitest";
import { getStandardProfile, type StandardName } from "./standard.js";

describe("getStandardProfile", () => {
  it("returns openai profile for 'openai'", () => {
    const profile = getStandardProfile("openai");
    expect(profile.name).toBe("openai");
  });

  it("returns mcp-apps profile for 'mcp-apps'", () => {
    const profile = getStandardProfile("mcp-apps");
    expect(profile.name).toBe("mcp-apps");
  });

  it("throws on unknown standard", () => {
    expect(() => getStandardProfile("unknown" as StandardName)).toThrow(
      'Unknown standard: unknown'
    );
  });
});

describe("openai profile", () => {
  const profile = getStandardProfile("openai");

  it("has correct URI prefix", () => {
    expect(profile.uriPrefix).toBe("ui://");
  });

  it("has correct MIME type", () => {
    expect(profile.mimeType).toBe("text/html");
  });

  it("builds tool meta with openai/outputTemplate", () => {
    const meta = profile.buildToolMeta("ui://my_tool");
    expect(meta).toEqual({
      "openai/outputTemplate": "ui://my_tool",
      "openai/widgetAccessible": true,
    });
  });

  it("has validation marker for window.openai", () => {
    expect(profile.validationMarker).toBe("window.openai");
  });

  it("enables structuredContent", () => {
    expect(profile.useStructuredContent).toBe(true);
  });

  it("system prompt mentions window.openai", () => {
    expect(profile.systemPrompt).toContain("window.openai");
  });

  it("system prompt does not mention ext-apps", () => {
    expect(profile.systemPrompt).not.toContain("@modelcontextprotocol/ext-apps");
  });
});

describe("mcp-apps profile", () => {
  const profile = getStandardProfile("mcp-apps");

  it("has correct URI prefix", () => {
    expect(profile.uriPrefix).toBe("ui://");
  });

  it("has correct MIME type", () => {
    expect(profile.mimeType).toBe("text/html;profile=mcp-app");
  });

  it("builds tool meta with ui.resourceUri", () => {
    const meta = profile.buildToolMeta("ui://my_tool");
    expect(meta).toEqual({
      ui: { resourceUri: "ui://my_tool" },
    });
  });

  it("has validation marker for ext-apps", () => {
    expect(profile.validationMarker).toBe("@modelcontextprotocol/ext-apps");
  });

  it("disables structuredContent", () => {
    expect(profile.useStructuredContent).toBe(false);
  });

  it("system prompt mentions App class and ext-apps", () => {
    expect(profile.systemPrompt).toContain("@modelcontextprotocol/ext-apps");
    expect(profile.systemPrompt).toContain("app.connect()");
    expect(profile.systemPrompt).toContain("app.ontoolresult");
    expect(profile.systemPrompt).toContain("app.callServerTool");
  });

  it("system prompt does not mention window.openai", () => {
    expect(profile.systemPrompt).not.toContain("window.openai");
  });
});
