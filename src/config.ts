// ABOUTME: Configuration parsing from CLI args and environment variables.
// ABOUTME: Defines the WrapperConfig interface and buildConfig function.

import type { StandardName } from "./standard.js";

export interface WrapperConfig {
  // Upstream server connection
  upstream:
    | { transport: "stdio"; command: string; args: string[] }
    | { transport: "sse"; url: string }
    | { transport: "http"; url: string; bearerToken?: string }
    | { transport: "deferred" };

  // LLM configuration
  llm: {
    provider: "anthropic" | "openai";
    model?: string;
    apiKey: string;
  };

  // Cache configuration
  cache: {
    directory: string;
  };

  // UI standard
  standard: StandardName;

  // Server configuration
  server: {
    port: number;
  };

  // Pipe state for mcpblox composition
  pipe: {
    stdinIsPipe: boolean;
    stdoutIsPipe: boolean;
  };
}

export interface CLIOptions {
  upstream?: string;
  upstreamUrl?: string;
  upstreamToken?: string;
  provider?: string;
  model?: string;
  apiKey?: string;
  cacheDir?: string;
  port?: number;
  standard?: string;
  stdinIsPipe?: boolean;
  stdoutIsPipe?: boolean;
}

export function buildConfig(options: CLIOptions): WrapperConfig {
  // Detect pipe state (allow override for testing)
  const stdinIsPipe = options.stdinIsPipe ?? !process.stdin.isTTY;
  const stdoutIsPipe = options.stdoutIsPipe ?? !process.stdout.isTTY;

  // Determine upstream transport
  let upstream: WrapperConfig["upstream"];
  if (options.upstreamUrl) {
    // Check for bearer token (CLI option or environment variable)
    const bearerToken =
      options.upstreamToken || process.env.MCP_UPSTREAM_BEARER_TOKEN;
    if (bearerToken) {
      // Use HTTP transport with bearer auth (for servers like Alpha Vantage)
      upstream = { transport: "http", url: options.upstreamUrl, bearerToken };
    } else {
      // Use SSE transport (standard MCP remote transport)
      upstream = { transport: "sse", url: options.upstreamUrl };
    }
  } else if (options.upstream) {
    const parts = options.upstream.split(" ");
    upstream = {
      transport: "stdio",
      command: parts[0],
      args: parts.slice(1),
    };
  } else if (stdinIsPipe) {
    // Upstream URL will be read from stdin by index.ts
    upstream = { transport: "deferred" };
  } else {
    throw new Error(
      "Must specify --upstream or --upstream-url"
    );
  }

  // Determine LLM provider
  const provider = (options.provider || "anthropic") as "anthropic" | "openai";

  // Get API key
  let apiKey = options.apiKey;
  if (!apiKey) {
    if (provider === "anthropic") {
      apiKey = process.env.ANTHROPIC_API_KEY;
    } else if (provider === "openai") {
      apiKey = process.env.OPENAI_API_KEY;
    }
  }
  if (!apiKey) {
    throw new Error(
      `No API key provided. Set ${provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"} or use --api-key`
    );
  }

  // Cache directory
  const cacheDir =
    options.cacheDir ||
    process.env.MCP_GEN_UI_CACHE_DIR ||
    ".mcp-gen-ui-cache";

  // UI standard
  const standardInput = options.standard || "mcp-apps";
  if (standardInput !== "openai" && standardInput !== "mcp-apps") {
    throw new Error(`Invalid standard: ${standardInput}. Must be "openai" or "mcp-apps".`);
  }
  const standard: StandardName = standardInput;

  // Server port: default to 0 (OS-assigned) when stdout is piped
  const port = options.port ?? (stdoutIsPipe ? 0 : 8000);

  return {
    upstream,
    llm: {
      provider,
      model: options.model,
      apiKey,
    },
    cache: {
      directory: cacheDir,
    },
    standard,
    server: {
      port,
    },
    pipe: {
      stdinIsPipe,
      stdoutIsPipe,
    },
  };
}
