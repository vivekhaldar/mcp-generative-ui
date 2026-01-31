# MCP Generative UI Wrapper

A proxy layer that wraps any "plain" MCP server (tools-only) and automatically generates interactive UI resources using an LLM at runtime.

## What It Does

Point the wrapper at any existing MCP server, and it automatically:
1. **Discovers tools** from the underlying server
2. **Generates interactive UIs** for each tool using an LLM
3. **Caches generated UIs** for fast subsequent access
4. **Supports iterative refinement** - say "make the table sortable" and the UI regenerates

## Supported UI Standards

The wrapper supports two MCP UI standards:

- **MCP Apps** (`--standard mcp-apps`, default) — Uses the `@modelcontextprotocol/ext-apps` App API. UIs are self-contained HTML that communicate with the host via the MCP Apps SDK.
- **OpenAI Apps SDK** (`--standard openai`) — Uses the `window.openai` API (Skybridge). UIs communicate with the host via the OpenAI Apps SDK, as used in ChatGPT.

Both standards produce self-contained HTML with inline JS/CSS. The wrapper generates UIs tailored to the selected standard's API surface.

## Why?

The MCP ecosystem has hundreds of tool-only servers with no visual interface. Building UIs for each tool requires frontend development effort and blocks exploration of "what would this look like as an app?"

This wrapper creates a zero-friction path from "I have tools" to "I have interactive UIs."

## How It Works

```
┌─────────────────┐     ┌─────────────────────┐     ┌─────────────────┐
│    MCP Host     │────▶│  Generative UI      │────▶│  Underlying     │
│ (Claude Desktop)│◀────│     Wrapper         │◀────│  MCP Server     │
└─────────────────┘     └─────────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌─────────────┐
                        │   LLM API   │
                        │ (Anthropic, │
                        │  OpenAI)    │
                        └─────────────┘
```

The wrapper:
- Exposes all upstream tools with `_meta.ui.resourceUri` pointing to generated UIs
- Serves `ui://` resources with LLM-generated HTML
- Proxies tool calls transparently to the underlying server
- Accepts refinement requests via the `_ui_refine` tool

## Usage

```bash
# Wrap a stdio MCP server
mcp-gen-ui --upstream "uvx mcp-server-yfinance" --provider anthropic

# Wrap an HTTP MCP server
mcp-gen-ui --upstream-url http://localhost:9000/mcp --provider openai

# Use OpenAI Apps SDK standard instead of MCP Apps
mcp-gen-ui --upstream "uvx mcp-server-yfinance" --standard openai

# Specify model and port
mcp-gen-ui --upstream "node my-server.js" --provider anthropic --model claude-sonnet-4-20250514 --port 8000
```

## Features

- **Zero-config**: Point at any MCP server, get UIs automatically
- **Dual-standard**: Supports both MCP Apps and OpenAI Apps SDK
- **On-demand generation**: Generate on first request, cache for performance
- **Iterative refinement**: Natural language feedback to customize UIs
- **Full interactivity**: Generated UIs can call tools, update dynamically
- **Graceful fallback**: Minimal UI for tools without meaningful visual output

## Design Documents

See `docs/` for design documents:
- `PRODUCT_SPEC.md` - Requirements and user stories
- `PRODUCT_SPEC-design.md` - Technical architecture and implementation plan

## License

Apache 2.0
