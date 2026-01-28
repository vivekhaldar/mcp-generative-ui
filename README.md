# MCP Generative UI Wrapper

A proxy layer that wraps any "plain" MCP server (tools-only) and automatically generates interactive UI resources using an LLM at runtime.

## What It Does

Point the wrapper at any existing MCP server, and it automatically:
1. **Discovers tools** from the underlying server
2. **Generates interactive UIs** for each tool using an LLM
3. **Caches generated UIs** for fast subsequent access
4. **Supports iterative refinement** - say "make the table sortable" and the UI regenerates

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

## Status

**Design Phase** - Product spec and technical design are complete. Implementation is not yet started.

See `docs/` for design documents:
- `PRODUCT_SPEC.md` - Requirements and user stories
- `PRODUCT_SPEC-design.md` - Technical architecture and implementation plan

## Planned Usage

```bash
# Basic usage (proposed CLI)
mcp-gen-ui --upstream "node weather-server.js" --llm anthropic

# With config file
mcp-gen-ui --config ./wrapper-config.json
```

## Key Features (Planned)

- **Zero-config**: Point at any MCP server, get UIs automatically
- **On-demand generation**: Generate on first request, cache for performance
- **Iterative refinement**: Natural language feedback to customize UIs
- **Full interactivity**: Generated UIs can call tools, update dynamically
- **Graceful fallback**: Minimal UI for tools without meaningful visual output

## License

MIT
