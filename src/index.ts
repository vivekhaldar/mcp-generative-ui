#!/usr/bin/env node
// ABOUTME: CLI entry point for the MCP Generative UI wrapper.
// ABOUTME: Parses arguments, handles pipe protocol, and starts the wrapper server.

import { program } from "commander";
import { buildConfig } from "./config.js";
import { createLLMClient } from "./llm.js";
import { createWrapperServer } from "./server.js";
import { readUpstreamUrl, writeUpstreamUrl } from "./pipe.js";
import { log } from "./log.js";

program
  .name("mcp-gen-ui")
  .description("MCP wrapper that auto-generates interactive UIs for tools")
  .version("0.1.0")
  .option("--upstream <command>", "Upstream MCP server command (stdio transport)")
  .option("--upstream-url <url>", "Upstream MCP server URL (HTTP/SSE transport)")
  .option("--upstream-token <token>", "Bearer token for upstream auth (or MCP_UPSTREAM_BEARER_TOKEN env)")
  .option("--provider <provider>", "LLM provider: anthropic or openai", "anthropic")
  .option("--model <model>", "LLM model to use")
  .option("--api-key <key>", "LLM API key (or use ANTHROPIC_API_KEY/OPENAI_API_KEY env)")
  .option("--cache-dir <dir>", "Cache directory", ".mcp-gen-ui-cache")
  .option("--standard <standard>", "UI standard: openai or mcp-apps", "mcp-apps")
  .option("--port <port>", "Server port (for HTTP mode)")
  .parse();

const options = program.opts();

async function main() {
  try {
    const config = buildConfig({
      upstream: options.upstream,
      upstreamUrl: options.upstreamUrl,
      upstreamToken: options.upstreamToken,
      provider: options.provider,
      model: options.model,
      apiKey: options.apiKey,
      cacheDir: options.cacheDir,
      standard: options.standard,
      port: options.port ? parseInt(options.port, 10) : undefined,
    });

    // If upstream is deferred, read it from stdin pipe
    if (config.upstream.transport === "deferred") {
      log("Reading upstream URL from stdin pipe...");
      const upstreamUrl = await readUpstreamUrl();
      log(`Received upstream URL: ${upstreamUrl}`);
      // Mutate config with resolved upstream
      (config as any).upstream = { transport: "streamable-http", url: upstreamUrl };
    } else if (config.pipe.stdinIsPipe) {
      // Explicit upstream provided but stdin is a pipe — drain stdin so upstream doesn't block
      process.stdin.resume();
    }

    log("Starting MCP Gen-UI wrapper...");
    if (config.upstream.transport === "stdio") {
      log(`  Upstream: ${config.upstream.command}`);
    } else if (config.upstream.transport !== "deferred") {
      log(`  Upstream: ${config.upstream.url}`);
    }
    log(`  LLM: ${config.llm.provider} (${config.llm.model || "default model"})`);
    log(`  Cache: ${config.cache.directory}`);
    log(`  Standard: ${config.standard}`);

    const llm = createLLMClient(config.llm);
    const server = await createWrapperServer(config, llm);

    // Handle shutdown
    process.on("SIGINT", async () => {
      log("\nShutting down...");
      await server.stop();
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      await server.stop();
      process.exit(0);
    });

    // Handle broken pipe (downstream consumer closed)
    process.on("SIGPIPE", async () => {
      log("Downstream pipe closed, shutting down...");
      await server.stop();
      process.exit(0);
    });

    const port = await server.start();

    // If stdout is a pipe, write our URL for downstream consumers
    if (config.pipe.stdoutIsPipe) {
      writeUpstreamUrl(`http://localhost:${port}/mcp`);
    }
  } catch (err) {
    log(`Fatal error: ${err}`);
    process.exit(1);
  }
}

main();
