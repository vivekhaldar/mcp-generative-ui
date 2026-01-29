// ABOUTME: MCP server wrapper that proxies tools and serves generated UIs.
// ABOUTME: Connects to upstream server, adds ui:// resources, handles refinement.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, SSEClientTransport, HttpClientTransport } from "./transport/base.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, IncomingMessage, ServerResponse } from "http";
import type { WrapperConfig } from "./config.js";
import type { LLMClient } from "./llm.js";
import {
  createCache,
  computeSchemaHash,
  computeRefinementHash,
} from "./cache.js";
import { createGenerator, type ToolDefinition } from "./generator.js";

export interface WrapperServer {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export async function createWrapperServer(
  config: WrapperConfig,
  llm: LLMClient
): Promise<WrapperServer> {
  // Store tool definitions from upstream
  const tools = new Map<string, ToolDefinition>();

  // Store refinement history per tool
  const refinements = new Map<string, string[]>();

  // Track which tools are "inner" tools that need to be proxied via TOOL_CALL
  const innerTools = new Set<string>();

  // Create cache
  const cache = createCache(config.cache.directory);
  cache.load();

  // Create generator
  const generator = createGenerator({ llm });

  // Create upstream client
  const upstreamClient = new Client(
    { name: "mcp-gen-ui-client", version: "0.1.0" },
    { capabilities: {} }
  );

  // Helper to generate or get cached UI
  async function getOrGenerateUI(toolName: string): Promise<string> {
    const tool = tools.get(toolName);
    if (!tool) {
      throw new Error(`Tool not found: ${toolName}`);
    }

    const schemaHash = computeSchemaHash(tool.inputSchema);
    const history = refinements.get(toolName) || [];
    const refinementHash = computeRefinementHash(history);

    // Check cache
    const cached = cache.get(toolName, schemaHash, refinementHash);
    if (cached) {
      console.log(`Cache hit for ${toolName}`);
      return cached.html;
    }

    // Generate
    console.log(`Cache miss for ${toolName}, generating...`);
    const { html } = await generator.generate(tool, history);

    // Cache
    cache.set(toolName, schemaHash, refinementHash, html);

    return html;
  }

  // Handle JSON-RPC request
  async function handleRequest(method: string, params: any): Promise<any> {
    if (method === "initialize") {
      return {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "mcp-gen-ui", version: "0.1.0" },
        capabilities: {
          tools: { list: true, call: true },
          resources: { list: true, read: true },
        },
      };
    }

    if (method === "notifications/initialized") {
      return {};
    }

    if (method === "tools/list") {
      const toolList = Array.from(tools.values()).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        _meta: {
          "openai/outputTemplate": `ui://${tool.name}`,
          "openai/widgetAccessible": true,
        },
      }));

      // Add wrapper tools
      toolList.push({
        name: "_ui_refine",
        description:
          "Refine the generated UI for a tool based on natural language feedback",
        inputSchema: {
          type: "object",
          properties: {
            toolName: {
              type: "string",
              description: "Name of the tool whose UI to refine",
            },
            feedback: {
              type: "string",
              description: "Natural language description of desired changes",
            },
          },
          required: ["toolName", "feedback"],
        },
      });

      toolList.push({
        name: "_ui_regenerate",
        description:
          "Force regeneration of the UI for a tool, ignoring the cache",
        inputSchema: {
          type: "object",
          properties: {
            toolName: {
              type: "string",
              description: "Name of the tool to regenerate UI for",
            },
            clearRefinements: {
              type: "boolean",
              description: "If true, also clear refinement history",
              default: false,
            },
          },
          required: ["toolName"],
        },
      });

      return { tools: toolList };
    }

    if (method === "tools/call") {
      const { name, arguments: args } = params;

      // Handle wrapper tools
      if (name === "_ui_refine") {
        const toolName = args?.toolName as string;
        const feedback = args?.feedback as string;

        if (!tools.has(toolName)) {
          return {
            content: [{ type: "text", text: `Tool not found: ${toolName}` }],
            isError: true,
          };
        }

        // Add refinement
        const history = refinements.get(toolName) || [];
        history.push(feedback);
        refinements.set(toolName, history);

        // Invalidate cache
        cache.invalidate(toolName);

        return {
          content: [
            {
              type: "text",
              text: `UI refinement queued for tool '${toolName}'. The updated UI will be available on next resource request.`,
            },
          ],
        };
      }

      if (name === "_ui_regenerate") {
        const toolName = args?.toolName as string;
        const clearRefinements = args?.clearRefinements as boolean;

        if (!tools.has(toolName)) {
          return {
            content: [{ type: "text", text: `Tool not found: ${toolName}` }],
            isError: true,
          };
        }

        // Clear refinements if requested
        if (clearRefinements) {
          refinements.delete(toolName);
        }

        // Invalidate cache
        cache.invalidate(toolName);

        // Generate immediately
        const tool = tools.get(toolName)!;
        const history = refinements.get(toolName) || [];
        const start = Date.now();
        const { html } = await generator.generate(tool, history);
        const elapsed = Date.now() - start;

        // Cache the result
        const schemaHash = computeSchemaHash(tool.inputSchema);
        const refinementHash = computeRefinementHash(history);
        cache.set(tool.name, schemaHash, refinementHash, html);

        return {
          content: [
            {
              type: "text",
              text: `UI regenerated for tool '${toolName}'. Generation took ${elapsed}ms.`,
            },
          ],
        };
      }

      // Check if this is an inner tool that needs to be proxied via TOOL_CALL
      if (innerTools.has(name)) {
        try {
          const result = await upstreamClient.callTool({
            name: "TOOL_CALL",
            arguments: {
              tool_name: name,
              arguments: JSON.stringify(args || {}),
            },
          });
          return result;
        } catch (err) {
          return {
            content: [
              {
                type: "text",
                text: `Tool call failed: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
            isError: true,
          };
        }
      }

      // Proxy to upstream directly
      try {
        const result = await upstreamClient.callTool({
          name,
          arguments: args || {},
        });
        return result;
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Tool call failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }

    if (method === "resources/list") {
      const resources = Array.from(tools.values()).map((tool) => ({
        uri: `ui://${tool.name}`,
        name: `${tool.name} UI`,
        description: `Generated interactive UI for ${tool.name}`,
        mimeType: "text/html",
      }));

      return { resources };
    }

    if (method === "resources/read") {
      const uri = params.uri;

      if (!uri.startsWith("ui://")) {
        throw new Error(`Invalid resource URI: ${uri}`);
      }

      const toolName = uri.slice(5); // Remove "ui://"
      const html = await getOrGenerateUI(toolName);

      return {
        contents: [
          {
            uri,
            mimeType: "text/html",
            text: html,
          },
        ],
      };
    }

    throw new Error(`Unknown method: ${method}`);
  }

  let httpServer: ReturnType<typeof createServer> | null = null;

  return {
    async start(): Promise<void> {
      // Connect to upstream
      let transport;
      if (config.upstream.transport === "stdio") {
        console.log(
          `Connecting to upstream via stdio: ${config.upstream.command}`
        );
        transport = new StdioClientTransport({
          command: config.upstream.command,
          args: config.upstream.args,
        });
      } else if (config.upstream.transport === "http") {
        console.log(`Connecting to upstream via HTTP: ${config.upstream.url}`);
        transport = new HttpClientTransport({
          url: new URL(config.upstream.url),
          bearerToken: config.upstream.bearerToken,
        });
      } else {
        console.log(`Connecting to upstream via SSE: ${config.upstream.url}`);
        transport = new SSEClientTransport(new URL(config.upstream.url));
      }

      await upstreamClient.connect(transport);
      console.log("Connected to upstream server");

      // Fetch tools from upstream
      const result = await upstreamClient.listTools();
      for (const tool of result.tools) {
        tools.set(tool.name, {
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema as Record<string, unknown>,
        });
      }
      console.log(`Discovered ${tools.size} tool(s) from upstream`);

      // Check if upstream uses meta-tool pattern (has TOOL_LIST, TOOL_GET, TOOL_CALL)
      const hasToolList = tools.has("TOOL_LIST");
      const hasToolGet = tools.has("TOOL_GET");
      const hasToolCall = tools.has("TOOL_CALL");

      if (hasToolList && hasToolGet && hasToolCall) {
        console.log("Detected meta-tool pattern, discovering inner tools...");

        // Call TOOL_LIST to get available inner tools
        const listResult = await upstreamClient.callTool({
          name: "TOOL_LIST",
          arguments: {},
        });

        // Parse the result (it's a Python-style list string)
        const listContent = listResult.content as Array<{ type: string; text: string }>;
        const listText = listContent?.[0]?.text || "[]";

        // Parse Python-style dict list: [{'name': '...', 'description': '...'}]
        // Use regex extraction since descriptions may contain apostrophes
        let innerToolList: Array<{ name: string; description: string }> = [];
        try {
          // Match each {'name': '...', 'description': '...'} entry
          const entryPattern = /\{'name':\s*'([^']+)',\s*'description':\s*'((?:[^'\\]|\\.)*)'\}/g;
          let match;
          while ((match = entryPattern.exec(listText)) !== null) {
            innerToolList.push({
              name: match[1],
              description: match[2].replace(/\\'/g, "'"),
            });
          }
        } catch (e) {
          console.warn("Failed to parse TOOL_LIST response:", e);
        }

        console.log(`Found ${innerToolList.length} inner tools, fetching schemas...`);

        // Fetch schema for each inner tool (limit to first 20 for performance)
        const toolsToFetch = innerToolList.slice(0, 20);
        for (const innerTool of toolsToFetch) {
          try {
            const getResult = await upstreamClient.callTool({
              name: "TOOL_GET",
              arguments: { tool_name: innerTool.name },
            });

            const getContent = getResult.content as Array<{ type: string; text: string }>;
            const getText = getContent?.[0]?.text || "{}";

            // Extract parameters section (it's valid JSON structure within the Python dict)
            // Format: {'name': '...', 'description': '...', 'parameters': {...}}
            const parametersMatch = getText.match(/'parameters':\s*(\{[\s\S]*\})\s*\}$/);
            let inputSchema: Record<string, unknown> = { type: "object", properties: {} };

            if (parametersMatch) {
              try {
                // The parameters section is valid JSON-like, just with single quotes
                // First, escape any embedded double quotes in descriptions
                let paramsText = parametersMatch[1];
                // Replace double quotes that aren't at word boundaries with escaped quotes
                paramsText = paramsText.replace(/"([^"]+)"/g, "\\\"$1\\\"");
                paramsText = paramsText
                  .replace(/'/g, '"')
                  .replace(/None/g, "null")
                  .replace(/True/g, "true")
                  .replace(/False/g, "false");
                inputSchema = JSON.parse(paramsText);
              } catch {
                // Parse failed - try extracting just the property names
                const propsMatch = getText.match(/'properties':\s*\{([^}]+)/);
                if (propsMatch) {
                  const propNames = propsMatch[1].match(/'(\w+)':/g);
                  if (propNames) {
                    const properties: Record<string, unknown> = {};
                    propNames.forEach((p) => {
                      const name = p.replace(/'/g, "").replace(":", "");
                      properties[name] = { type: "string" };
                    });
                    inputSchema = { type: "object", properties };
                  }
                }
              }
            }

            // Add as a first-class tool (use description from TOOL_LIST)
            const toolDef: ToolDefinition = {
              name: innerTool.name,
              description: innerTool.description.replace(/\\n/g, " ").trim(),
              inputSchema,
            };

            tools.set(innerTool.name, toolDef);
            innerTools.add(innerTool.name);

            console.log(`  + ${innerTool.name}`);
          } catch (e) {
            console.warn(`  Failed to fetch schema for ${innerTool.name}:`, e);
          }
        }

        // Remove the meta-tools from the exposed list (keep them internally)
        tools.delete("TOOL_LIST");
        tools.delete("TOOL_GET");
        tools.delete("TOOL_CALL");

        console.log(`Exposed ${innerTools.size} inner tools`);
      }

      // Start HTTP server
      httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
        // CORS headers
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");

        if (req.method === "OPTIONS") {
          res.writeHead(204);
          res.end();
          return;
        }

        if (req.method !== "POST") {
          res.writeHead(405, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }

        // Read body
        let body = "";
        for await (const chunk of req) {
          body += chunk;
        }

        try {
          const request = JSON.parse(body);
          const { jsonrpc, id, method, params } = request;

          if (jsonrpc !== "2.0") {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid JSON-RPC version" }));
            return;
          }

          console.log(`<-- ${method}`);
          const result = await handleRequest(method, params || {});
          console.log(`--> ${method} response`);

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
        } catch (err) {
          console.error("Request error:", err);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: null,
              error: {
                code: -32603,
                message: err instanceof Error ? err.message : String(err),
              },
            })
          );
        }
      });

      const port = config.server.port;
      await new Promise<void>((resolve) => {
        httpServer!.listen(port, () => {
          console.log(`MCP Gen-UI wrapper server listening on http://localhost:${port}`);
          resolve();
        });
      });
    },

    async stop(): Promise<void> {
      if (httpServer) {
        await new Promise<void>((resolve) => {
          httpServer!.close(() => resolve());
        });
      }
      await upstreamClient.close();
    },
  };
}
