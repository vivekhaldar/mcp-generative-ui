// ABOUTME: Re-exports MCP SDK transports for upstream server connection.
// ABOUTME: Provides factory function to create appropriate transport based on config.

export { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
export { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
export { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
export { HttpClientTransport } from "./http.js";
export type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
