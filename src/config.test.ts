// ABOUTME: Tests for config parsing with the standard field.
// ABOUTME: Verifies default, explicit, and invalid standard values.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildConfig } from "./config.js";

describe("buildConfig standard field", () => {
  const baseOptions = {
    upstream: "node test-servers/weather-server.js",
    apiKey: "test-key-123",
  };

  it("defaults to mcp-apps when standard is not specified", () => {
    const config = buildConfig(baseOptions);
    expect(config.standard).toBe("mcp-apps");
  });

  it("accepts 'openai' as standard", () => {
    const config = buildConfig({ ...baseOptions, standard: "openai" });
    expect(config.standard).toBe("openai");
  });

  it("accepts 'mcp-apps' as standard", () => {
    const config = buildConfig({ ...baseOptions, standard: "mcp-apps" });
    expect(config.standard).toBe("mcp-apps");
  });

  it("throws on invalid standard", () => {
    expect(() => buildConfig({ ...baseOptions, standard: "invalid" })).toThrow(
      'Invalid standard: invalid'
    );
  });
});
