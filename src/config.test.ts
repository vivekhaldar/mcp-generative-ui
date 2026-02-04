// ABOUTME: Tests for config parsing including standard, pipe, and prompt fields.
// ABOUTME: Verifies default, explicit, and invalid standard values plus pipe and prompt behavior.

import { describe, it, expect, afterEach } from "vitest";
import { buildConfig } from "./config.js";
import { writeFileSync, unlinkSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("buildConfig standard field", () => {
  const baseOptions = {
    upstream: "node test-servers/weather-server.js",
    apiKey: "test-key-123",
    stdinIsPipe: false,
    stdoutIsPipe: false,
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

describe("buildConfig pipe behavior", () => {
  const baseOptions = {
    apiKey: "test-key-123",
    stdinIsPipe: false,
    stdoutIsPipe: false,
  };

  it("populates pipe state from options", () => {
    const config = buildConfig({
      ...baseOptions,
      upstream: "node server.js",
      stdinIsPipe: true,
      stdoutIsPipe: true,
    });
    expect(config.pipe).toEqual({ stdinIsPipe: true, stdoutIsPipe: true });
  });

  it("does not throw when upstream missing and stdin is pipe", () => {
    const config = buildConfig({
      ...baseOptions,
      stdinIsPipe: true,
    });
    expect(config.upstream).toEqual({ transport: "deferred" });
  });

  it("throws when upstream missing and stdin is not pipe", () => {
    expect(() => buildConfig(baseOptions)).toThrow(
      "Must specify --upstream or --upstream-url"
    );
  });

  it("defaults port to 0 when stdout is pipe and no explicit port", () => {
    const config = buildConfig({
      ...baseOptions,
      upstream: "node server.js",
      stdoutIsPipe: true,
    });
    expect(config.server.port).toBe(0);
  });

  it("defaults port to 8000 when stdout is not pipe and no explicit port", () => {
    const config = buildConfig({
      ...baseOptions,
      upstream: "node server.js",
    });
    expect(config.server.port).toBe(8000);
  });

  it("uses explicit port even when stdout is pipe", () => {
    const config = buildConfig({
      ...baseOptions,
      upstream: "node server.js",
      stdoutIsPipe: true,
      port: 9999,
    });
    expect(config.server.port).toBe(9999);
  });

  it("uses explicit upstream even when stdin is pipe", () => {
    const config = buildConfig({
      ...baseOptions,
      upstream: "node server.js",
      stdinIsPipe: true,
    });
    expect(config.upstream).toEqual({
      transport: "stdio",
      command: "node",
      args: ["server.js"],
    });
  });
});

describe("buildConfig upstream quoted arguments", () => {
  const baseOptions = {
    apiKey: "test-key-123",
    stdinIsPipe: false,
    stdoutIsPipe: false,
  };

  it("parses single-quoted argument with spaces", () => {
    const config = buildConfig({
      ...baseOptions,
      upstream: "node server.js --name 'my server'",
    });
    expect(config.upstream).toEqual({
      transport: "stdio",
      command: "node",
      args: ["server.js", "--name", "my server"],
    });
  });

  it("parses double-quoted argument with spaces", () => {
    const config = buildConfig({
      ...baseOptions,
      upstream: 'node server.js --name "my server"',
    });
    expect(config.upstream).toEqual({
      transport: "stdio",
      command: "node",
      args: ["server.js", "--name", "my server"],
    });
  });
});

describe("buildConfig upstream transport", () => {
  const baseOptions = {
    apiKey: "test-key-123",
    stdinIsPipe: false,
    stdoutIsPipe: false,
  };

  it("defaults to streamable-http when --upstream-url given without token", () => {
    const config = buildConfig({
      ...baseOptions,
      upstreamUrl: "http://localhost:3000/mcp",
    });
    expect(config.upstream).toEqual({
      transport: "streamable-http",
      url: "http://localhost:3000/mcp",
      bearerToken: undefined,
    });
  });

  it("defaults to streamable-http when --upstream-url given with token", () => {
    const config = buildConfig({
      ...baseOptions,
      upstreamUrl: "http://localhost:3000/mcp",
      upstreamToken: "my-token",
    });
    expect(config.upstream).toEqual({
      transport: "streamable-http",
      url: "http://localhost:3000/mcp",
      bearerToken: "my-token",
    });
  });

  it("explicit --upstream-transport sse overrides default", () => {
    const config = buildConfig({
      ...baseOptions,
      upstreamUrl: "http://localhost:3000/sse",
      upstreamTransport: "sse",
    });
    expect(config.upstream).toEqual({
      transport: "sse",
      url: "http://localhost:3000/sse",
      bearerToken: undefined,
    });
  });

  it("explicit --upstream-transport http uses http transport", () => {
    const config = buildConfig({
      ...baseOptions,
      upstreamUrl: "http://localhost:3000/api",
      upstreamTransport: "http",
    });
    expect(config.upstream).toEqual({
      transport: "http",
      url: "http://localhost:3000/api",
      bearerToken: undefined,
    });
  });

  it("bearer token passed through on streamable-http transport", () => {
    const config = buildConfig({
      ...baseOptions,
      upstreamUrl: "http://localhost:3000/mcp",
      upstreamTransport: "streamable-http",
      upstreamToken: "secret",
    });
    expect(config.upstream).toHaveProperty("bearerToken", "secret");
    expect(config.upstream).toHaveProperty("transport", "streamable-http");
  });

  it("bearer token passed through on sse transport", () => {
    const config = buildConfig({
      ...baseOptions,
      upstreamUrl: "http://localhost:3000/sse",
      upstreamTransport: "sse",
      upstreamToken: "secret",
    });
    expect(config.upstream).toHaveProperty("bearerToken", "secret");
    expect(config.upstream).toHaveProperty("transport", "sse");
  });

  it("throws on invalid --upstream-transport value", () => {
    expect(() =>
      buildConfig({
        ...baseOptions,
        upstreamUrl: "http://localhost:3000/mcp",
        upstreamTransport: "websocket",
      })
    ).toThrow("Invalid upstream transport: websocket");
  });

  it("--upstream-transport ignored when using --upstream (stdio)", () => {
    const config = buildConfig({
      ...baseOptions,
      upstream: "node server.js",
      upstreamTransport: "sse",
    });
    expect(config.upstream).toEqual({
      transport: "stdio",
      command: "node",
      args: ["server.js"],
    });
  });
});

describe("buildConfig prompt options", () => {
  const baseOptions = {
    upstream: "node server.js",
    apiKey: "test-key-123",
    stdinIsPipe: false,
    stdoutIsPipe: false,
  };

  const tmpFile = join(tmpdir(), "mcp-gen-ui-test-prompt.txt");

  afterEach(() => {
    try { unlinkSync(tmpFile); } catch {}
  });

  it("config.prompt is undefined when neither --prompt nor --prompt-file given", () => {
    const config = buildConfig(baseOptions);
    expect(config.prompt).toBeUndefined();
  });

  it("sets config.prompt from --prompt", () => {
    const config = buildConfig({ ...baseOptions, prompt: "Use dark theme" });
    expect(config.prompt).toBe("Use dark theme");
  });

  it("sets config.prompt from --prompt-file", () => {
    writeFileSync(tmpFile, "Use blue accents\n");
    const config = buildConfig({ ...baseOptions, promptFile: tmpFile });
    expect(config.prompt).toBe("Use blue accents");
  });

  it("concatenates file then inline when both --prompt-file and --prompt given", () => {
    writeFileSync(tmpFile, "File instructions");
    const config = buildConfig({
      ...baseOptions,
      promptFile: tmpFile,
      prompt: "Inline instructions",
    });
    expect(config.prompt).toBe("File instructions\nInline instructions");
  });

  it("throws when --prompt-file points to nonexistent file", () => {
    expect(() =>
      buildConfig({ ...baseOptions, promptFile: "/nonexistent/path.txt" })
    ).toThrow();
  });
});
