// ABOUTME: Tests for the _mcp_metadata hidden tool in the mcp-gen-ui server.
// ABOUTME: Verifies metadata response shape and that the tool is hidden from listing.

import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import { createWrapperServer } from "../../src/server.js";
import type { WrapperConfig } from "../../src/config.js";
import type { LLMClient } from "../../src/llm.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

function mcpRequest(
  port: number,
  method: string,
  params: Record<string, unknown> = {},
  id: number = 1,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: "2.0", method, params, id });
    const req = http.request(
      {
        hostname: "localhost",
        port,
        path: "/mcp",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString();
          try {
            if (raw.startsWith("event:") || raw.startsWith("data:")) {
              const lines = raw.split("\n");
              for (const line of lines) {
                if (line.startsWith("data: ")) {
                  try {
                    const parsed = JSON.parse(line.slice(6));
                    if (parsed.id === id) {
                      resolve(parsed);
                      return;
                    }
                  } catch {
                    // Not valid JSON, skip this line
                  }
                }
              }
              reject(new Error("No matching response in SSE stream"));
            } else {
              resolve(JSON.parse(raw));
            }
          } catch (e) {
            reject(new Error(`Failed to parse: ${raw.slice(0, 500)}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// Start a minimal upstream MCP server with one tool
async function startFakeUpstream(): Promise<{
  port: number;
  stop: () => Promise<void>;
}> {
  const mcpServer = new Server(
    { name: "fake-upstream", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "greet",
        description: "Say hello",
        inputSchema: {
          type: "object" as const,
          properties: { name: { type: "string" } },
          required: ["name"],
        },
      },
    ],
  }));

  mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name: toolName, arguments: args } = request.params;
    if (toolName === "greet") {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              greeting: `Hello ${(args as any)?.name || "world"}!`,
            }),
          },
        ],
      };
    }
    return {
      content: [{ type: "text" as const, text: "unknown tool" }],
      isError: true,
    };
  });

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await mcpServer.connect(transport);

  const httpServer = http.createServer(async (req, res) => {
    if (req.method === "POST" && (req.url === "/mcp" || req.url === "/")) {
      try {
        await transport.handleRequest(req, res);
      } catch {
        if (!res.headersSent) {
          res.writeHead(500);
          res.end();
        }
      }
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  const port = await new Promise<number>((resolve) => {
    httpServer.listen(0, "localhost", () => {
      resolve((httpServer.address() as any).port);
    });
  });

  return {
    port,
    async stop() {
      await transport.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      await mcpServer.close();
    },
  };
}

describe("_mcp_metadata", () => {
  let upstream: { port: number; stop: () => Promise<void> };
  let wrapper: { start(): Promise<number>; stop(): Promise<void> };

  afterEach(async () => {
    if (wrapper) await wrapper.stop().catch(() => {});
    if (upstream) await upstream.stop().catch(() => {});
  });

  it("returns metadata with stage=ui", async () => {
    upstream = await startFakeUpstream();

    const mockLLM: LLMClient = {
      async generate(_system: string, _user: string): Promise<string> {
        return '<!DOCTYPE html><html><head></head><body><script src="@modelcontextprotocol/ext-apps"></script><p>UI</p></body></html>';
      },
    };

    const config: WrapperConfig = {
      upstream: {
        transport: "streamable-http",
        url: `http://localhost:${upstream.port}/mcp`,
      },
      llm: { provider: "anthropic", apiKey: "test-key" },
      cache: {
        directory: "/tmp/mcp-gen-ui-test-cache-" + Date.now(),
      },
      standard: "mcp-apps",
      server: { port: 0 },
      pipe: { stdinIsPipe: false, stdoutIsPipe: false },
    };

    wrapper = await createWrapperServer(config, mockLLM);
    const wrapperPort = await wrapper.start();

    // Initialize
    await mcpRequest(wrapperPort, "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test", version: "1.0" },
    });

    // Call _mcp_metadata
    const response = await mcpRequest(
      wrapperPort,
      "tools/call",
      {
        name: "_mcp_metadata",
        arguments: {},
      },
      2,
    );

    const result = response.result as Record<string, unknown>;
    const content = result.content as Array<{ type: string; text: string }>;
    const metadata = JSON.parse(content[0].text);

    expect(metadata.stage).toBe("ui");
    expect(metadata.version).toBeDefined();
    expect(metadata.upstream_url).toBe(
      `http://localhost:${upstream.port}/mcp`,
    );
    expect(metadata.ui_resources).toBeDefined();
    expect(Array.isArray(metadata.ui_resources)).toBe(true);
    // The greet tool should have a UI resource (eagerly generated)
    expect(metadata.ui_resources.length).toBe(1);
    expect(metadata.ui_resources[0].tool_name).toBe("greet");
    expect(metadata.ui_resources[0].html).toContain("html");
  }, 30_000);

  it("does not list _mcp_metadata in tools/list", async () => {
    upstream = await startFakeUpstream();

    const mockLLM: LLMClient = {
      async generate(): Promise<string> {
        return '<!DOCTYPE html><html><head></head><body><script src="@modelcontextprotocol/ext-apps"></script></body></html>';
      },
    };

    const config: WrapperConfig = {
      upstream: {
        transport: "streamable-http",
        url: `http://localhost:${upstream.port}/mcp`,
      },
      llm: { provider: "anthropic", apiKey: "test-key" },
      cache: {
        directory: "/tmp/mcp-gen-ui-test-cache-" + Date.now(),
      },
      standard: "mcp-apps",
      server: { port: 0 },
      pipe: { stdinIsPipe: false, stdoutIsPipe: false },
    };

    wrapper = await createWrapperServer(config, mockLLM);
    const wrapperPort = await wrapper.start();

    await mcpRequest(wrapperPort, "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test", version: "1.0" },
    });

    const listResponse = await mcpRequest(
      wrapperPort,
      "tools/list",
      {},
      2,
    );
    const listResult = listResponse.result as Record<string, unknown>;
    const tools = listResult.tools as Array<{ name: string }>;
    expect(tools.map((t) => t.name)).not.toContain("_mcp_metadata");
  }, 15_000);
});
