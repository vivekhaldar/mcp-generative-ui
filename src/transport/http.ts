// ABOUTME: Custom HTTP transport for stateless MCP servers with Bearer auth.
// ABOUTME: Used for servers like Alpha Vantage that use POST JSON-RPC at a /mcp endpoint.

import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

export interface HttpTransportOptions {
  url: URL;
  bearerToken?: string;
}

export class HttpClientTransport implements Transport {
  private url: URL;
  private bearerToken?: string;
  private isClosed = false;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(options: HttpTransportOptions) {
    this.url = options.url;
    this.bearerToken = options.bearerToken;
  }

  async start(): Promise<void> {
    // Nothing to do for stateless HTTP
  }

  async close(): Promise<void> {
    this.isClosed = true;
    this.onclose?.();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (this.isClosed) {
      throw new Error("Transport is closed");
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.bearerToken) {
      headers["Authorization"] = `Bearer ${this.bearerToken}`;
    }

    // Check if this is a notification (no id field)
    const isNotification = !("id" in message);

    try {
      const response = await fetch(this.url.toString(), {
        method: "POST",
        headers,
        body: JSON.stringify(message),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
      }

      // Notifications don't have responses
      if (isNotification) {
        return;
      }

      const text = await response.text();
      if (!text) {
        // Empty response for notification-like messages
        return;
      }

      const result = JSON.parse(text) as JSONRPCMessage;

      // Deliver the response via onmessage callback
      this.onmessage?.(result);
    } catch (error) {
      this.onerror?.(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }
}
