// ABOUTME: MCP server wrapper that proxies tools and serves generated UIs.
// ABOUTME: Connects to upstream server, adds ui:// resources, handles refinement.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, SSEClientTransport, HttpClientTransport } from "./transport/base.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createServer, IncomingMessage, ServerResponse } from "http";
import type { WrapperConfig } from "./config.js";
import type { LLMClient } from "./llm.js";
import {
  createCache,
  computeSchemaHash,
  computeRefinementHash,
} from "./cache.js";
import { createGenerator, type ToolDefinition } from "./generator.js";
import { getStandardProfile } from "./standard.js";

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

  // Resolve standard profile
  const profile = getStandardProfile(config.standard);

  // Create cache
  const cache = createCache(config.cache.directory);
  cache.load();

  // Create generator
  const generator = createGenerator({ llm, standard: config.standard });

  // Create upstream client
  const upstreamClient = new Client(
    { name: "mcp-gen-ui-client", version: "0.1.0" },
    { capabilities: {} }
  );

  // Helper to add structuredContent for chatgpt-app-sim compatibility
  // chatgpt-app-sim expects result.structuredContent as a plain object (not array)
  function addStructuredContent(result: any): any {
    if (!result || !result.content || !Array.isArray(result.content)) {
      return result;
    }

    // Try to parse the first text content as JSON for structuredContent
    for (const item of result.content) {
      if (item.type === "text" && item.text) {
        try {
          const parsed = JSON.parse(item.text);
          if (typeof parsed === "object" && parsed !== null) {
            // structuredContent must be a plain object, not an array
            const structured = Array.isArray(parsed)
              ? { result: parsed }
              : parsed;
            return {
              ...result,
              structuredContent: structured,
            };
          }
        } catch {
          // Not JSON, continue
        }
      }
    }

    // Fallback: concatenate all text content into a single object
    const texts: string[] = [];
    for (const item of result.content) {
      if (item.type === "text" && item.text) {
        texts.push(item.text);
      }
    }
    return {
      ...result,
      structuredContent: { result: texts.length === 1 ? texts[0] : texts },
    };
  }

  // Helper to get sample output by calling the tool with minimal/sample input
  async function getSampleOutput(toolName: string, tool: ToolDefinition): Promise<unknown | undefined> {
    try {
      // Build sample arguments from the input schema
      const schema = tool.inputSchema as {
        properties?: Record<string, { type?: string; default?: unknown; enum?: string[] }>;
        required?: string[];
      };
      const properties = schema.properties || {};
      const required = schema.required || [];

      const sampleArgs: Record<string, unknown> = {};
      for (const [name, prop] of Object.entries(properties)) {
        // Only fill required fields with sample values
        if (required.includes(name)) {
          if (prop.default !== undefined) {
            sampleArgs[name] = prop.default;
          } else if (prop.enum && prop.enum.length > 0) {
            sampleArgs[name] = prop.enum[0];
          } else if (prop.type === "string") {
            // Use a reasonable sample value based on the field name
            if (name.toLowerCase().includes("city")) {
              sampleArgs[name] = "New York";
            } else if (name.toLowerCase().includes("symbol") || name.toLowerCase().includes("ticker")) {
              sampleArgs[name] = "AAPL";
            } else {
              sampleArgs[name] = "sample";
            }
          } else if (prop.type === "number" || prop.type === "integer") {
            sampleArgs[name] = 1;
          } else if (prop.type === "boolean") {
            sampleArgs[name] = true;
          }
        }
      }

      console.log(`Getting sample output for ${toolName} with args:`, sampleArgs);

      // Call the tool
      let result;
      if (innerTools.has(toolName)) {
        result = await upstreamClient.callTool({
          name: "TOOL_CALL",
          arguments: {
            tool_name: toolName,
            arguments: JSON.stringify(sampleArgs),
          },
        });
      } else {
        result = await upstreamClient.callTool({
          name: toolName,
          arguments: sampleArgs,
        });
      }

      return result;
    } catch (err) {
      console.warn(`Failed to get sample output for ${toolName}:`, err);
      return undefined;
    }
  }

  // Build the full resource URI for a tool
  function buildResourceUri(toolName: string): string {
    return `${profile.uriPrefix}${toolName}${profile.uriSuffix}`;
  }

  // Extract tool name from a resource URI
  function extractToolName(uri: string): string | null {
    if (!uri.startsWith(profile.uriPrefix)) return null;
    let name = uri.slice(profile.uriPrefix.length);
    if (profile.uriSuffix && name.endsWith(profile.uriSuffix)) {
      name = name.slice(0, -profile.uriSuffix.length);
    }
    return name;
  }

  // Cache key prefix to prevent cross-standard cache hits
  function cacheToolName(toolName: string): string {
    return `${config.standard}:${toolName}`;
  }

  // Helper to generate or get cached UI
  async function getOrGenerateUI(toolName: string): Promise<string> {
    const tool = tools.get(toolName);
    if (!tool) {
      throw new Error(`Tool not found: ${toolName}`);
    }

    const schemaHash = computeSchemaHash(tool.inputSchema);
    const history = refinements.get(toolName) || [];
    const refinementHash = computeRefinementHash(history);

    // Check cache (prefixed with standard to avoid cross-standard hits)
    const cName = cacheToolName(toolName);
    const cached = cache.get(cName, schemaHash, refinementHash);
    if (cached) {
      console.log(`Cache hit for ${toolName}`);
      return cached.html;
    }

    // Get sample output to help LLM generate better UI
    console.log(`Cache miss for ${toolName}, getting sample output...`);
    const sampleOutput = await getSampleOutput(toolName, tool);

    // Generate with sample output
    console.log(`Generating UI for ${toolName}...`);
    const toolWithSample = { ...tool, sampleOutput };
    const { html } = await generator.generate(toolWithSample, history);

    // Cache
    cache.set(cName, schemaHash, refinementHash, html);

    return html;
  }

  // Build tool list response for tools/list handler
  function buildToolList() {
    const toolList = Array.from(tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      _meta: profile.buildToolMeta(buildResourceUri(tool.name)),
    }));

    // Add wrapper tools (only for mcp-apps standard; openai requires outputTemplate on all tools)
    if (config.standard !== "openai") {
      toolList.push(
        {
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
        } as any,
        {
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
        } as any,
      );
    }

    return toolList;
  }

  // Handle tool call
  async function handleToolCall(name: string, args: Record<string, unknown> | undefined) {
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

      const history = refinements.get(toolName) || [];
      history.push(feedback);
      refinements.set(toolName, history);
      cache.invalidate(cacheToolName(toolName));

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
      const clearRefinementsFlag = args?.clearRefinements as boolean;

      if (!tools.has(toolName)) {
        return {
          content: [{ type: "text", text: `Tool not found: ${toolName}` }],
          isError: true,
        };
      }

      if (clearRefinementsFlag) {
        refinements.delete(toolName);
      }

      cache.invalidate(cacheToolName(toolName));

      const tool = tools.get(toolName)!;
      const history = refinements.get(toolName) || [];
      const start = Date.now();
      const { html } = await generator.generate(tool, history);
      const elapsed = Date.now() - start;

      const schemaHash = computeSchemaHash(tool.inputSchema);
      const refinementHash = computeRefinementHash(history);
      cache.set(cacheToolName(tool.name), schemaHash, refinementHash, html);

      return {
        content: [
          {
            type: "text",
            text: `UI regenerated for tool '${toolName}'. Generation took ${elapsed}ms.`,
          },
        ],
      };
    }

    // Proxy inner tools via TOOL_CALL
    if (innerTools.has(name)) {
      try {
        const result = await upstreamClient.callTool({
          name: "TOOL_CALL",
          arguments: {
            tool_name: name,
            arguments: JSON.stringify(args || {}),
          },
        });
        return profile.useStructuredContent ? addStructuredContent(result) : result;
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
      return profile.useStructuredContent ? addStructuredContent(result) : result;
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

  let httpServer: ReturnType<typeof createServer> | null = null;
  let mcpTransport: StreamableHTTPServerTransport | null = null;

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

        const listResult = await upstreamClient.callTool({
          name: "TOOL_LIST",
          arguments: {},
        });

        const listContent = listResult.content as Array<{ type: string; text: string }>;
        const listText = listContent?.[0]?.text || "[]";

        let innerToolList: Array<{ name: string; description: string }> = [];
        try {
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

        const toolsToFetch = innerToolList.slice(0, 20);
        for (const innerTool of toolsToFetch) {
          try {
            const getResult = await upstreamClient.callTool({
              name: "TOOL_GET",
              arguments: { tool_name: innerTool.name },
            });

            const getContent = getResult.content as Array<{ type: string; text: string }>;
            const getText = getContent?.[0]?.text || "{}";

            const parametersMatch = getText.match(/'parameters':\s*(\{[\s\S]*\})\s*\}$/);
            let inputSchema: Record<string, unknown> = { type: "object", properties: {} };

            if (parametersMatch) {
              try {
                let paramsText = parametersMatch[1];
                paramsText = paramsText.replace(/"([^"]+)"/g, "\\\"$1\\\"");
                paramsText = paramsText
                  .replace(/'/g, '"')
                  .replace(/None/g, "null")
                  .replace(/True/g, "true")
                  .replace(/False/g, "false");
                inputSchema = JSON.parse(paramsText);
              } catch {
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

        tools.delete("TOOL_LIST");
        tools.delete("TOOL_GET");
        tools.delete("TOOL_CALL");

        console.log(`Exposed ${innerTools.size} inner tools`);
      }

      // Create MCP SDK server with proper Streamable HTTP transport
      const mcpServer = new Server(
        { name: "mcp-gen-ui", version: "0.1.0" },
        {
          capabilities: {
            tools: {},
            resources: {},
          },
        },
      );

      // Register tools/list handler
      mcpServer.setRequestHandler(
        ListToolsRequestSchema,
        async () => {
          console.log("<-- tools/list");
          const toolList = buildToolList();
          console.log("--> tools/list response");
          return { tools: toolList };
        },
      );

      // Register tools/call handler
      mcpServer.setRequestHandler(
        CallToolRequestSchema,
        async (request: any) => {
          const { name, arguments: args } = request.params;
          console.log(`<-- tools/call ${name}`);
          const callResult = await handleToolCall(name, args);
          console.log(`--> tools/call ${name} response`);
          return callResult;
        },
      );

      // Register resources/list handler
      mcpServer.setRequestHandler(
        ListResourcesRequestSchema,
        async () => {
          console.log("<-- resources/list");
          const resources = Array.from(tools.values()).map((tool) => ({
            uri: buildResourceUri(tool.name),
            name: `${tool.name} UI`,
            description: `Generated interactive UI for ${tool.name}`,
            mimeType: profile.mimeType,
          }));
          console.log("--> resources/list response");
          return { resources };
        },
      );

      // Register resources/read handler
      mcpServer.setRequestHandler(
        ReadResourceRequestSchema,
        async (request: any) => {
          const uri = request.params.uri;
          console.log(`<-- resources/read ${uri}`);

          const toolName = extractToolName(uri);
          if (!toolName) {
            throw new Error(`Invalid resource URI: ${uri}`);
          }
          const html = await getOrGenerateUI(toolName);
          console.log(`--> resources/read ${uri} response`);

          return {
            contents: [
              {
                uri,
                mimeType: profile.mimeType,
                text: html,
              },
            ],
          };
        },
      );

      // Create Streamable HTTP transport (stateless for single-user)
      mcpTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      // Connect server to transport
      await mcpServer.connect(mcpTransport);

      // Start HTTP server routing to the transport
      httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
        // CORS headers
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id");

        if (req.method === "OPTIONS") {
          res.writeHead(204);
          res.end();
          return;
        }

        // Route /mcp to the MCP transport
        const url = new URL(req.url || "/", `http://localhost:${config.server.port}`);
        if (url.pathname === "/mcp" || url.pathname === "/") {
          try {
            await mcpTransport!.handleRequest(req, res);
          } catch (err) {
            console.error("Transport error:", err);
            if (!res.headersSent) {
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Internal server error" }));
            }
          }
        } else {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ detail: "Not Found" }));
        }
      });

      const port = config.server.port;
      await new Promise<void>((resolve) => {
        httpServer!.listen(port, () => {
          console.log(`MCP Gen-UI wrapper server listening on http://localhost:${port}`);
          console.log(`  MCP endpoint: http://localhost:${port}/mcp`);
          resolve();
        });
      });
    },

    async stop(): Promise<void> {
      if (mcpTransport) {
        await mcpTransport.close();
      }
      if (httpServer) {
        await new Promise<void>((resolve) => {
          httpServer!.close(() => resolve());
        });
      }
      await upstreamClient.close();
    },
  };
}
