#!/usr/bin/env node
// ABOUTME: CLI entry point for the MCP Generative UI wrapper.
// ABOUTME: Parses arguments and starts the wrapper server.

import { program } from "commander";
import { buildConfig } from "./config.js";
import { createLLMClient } from "./llm.js";
import { createWrapperServer } from "./server.js";

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
  .option("--port <port>", "Server port (for HTTP mode)", "8000")
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
      port: parseInt(options.port, 10),
    });

    console.log("Starting MCP Gen-UI wrapper...");
    console.log(`  Upstream: ${config.upstream.transport === "stdio" ? config.upstream.command : config.upstream.url}`);
    console.log(`  LLM: ${config.llm.provider} (${config.llm.model || "default model"})`);
    console.log(`  Cache: ${config.cache.directory}`);

    const llm = createLLMClient(config.llm);
    const server = await createWrapperServer(config, llm);

    // Handle shutdown
    process.on("SIGINT", async () => {
      console.log("\nShutting down...");
      await server.stop();
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      await server.stop();
      process.exit(0);
    });

    await server.start();
  } catch (err) {
    console.error("Fatal error:", err);
    process.exit(1);
  }
}

main();
