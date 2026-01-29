// ABOUTME: Configuration parsing from CLI args and environment variables.
// ABOUTME: Defines the WrapperConfig interface and buildConfig function.

export interface WrapperConfig {
  // Upstream server connection
  upstream:
    | { transport: "stdio"; command: string; args: string[] }
    | { transport: "sse"; url: string }
    | { transport: "http"; url: string; bearerToken?: string };

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

  // Server configuration
  server: {
    port: number;
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
}

export function buildConfig(options: CLIOptions): WrapperConfig {
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

  // Server port
  const port = options.port || 8000;

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
    server: {
      port,
    },
  };
}
