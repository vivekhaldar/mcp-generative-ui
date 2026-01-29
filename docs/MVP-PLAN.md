# MVP Plan: MCP Generative UI Wrapper

**Status:** Ready for implementation
**Estimated effort:** 8-12 hours

## Goal

Build a minimal but functional v1 that demonstrates the core value: **point at an MCP server, get auto-generated UIs for its tools**.

## Success Criteria

The wrapped MCP server can:
1. Connect to the [Alpha Vantage MCP server](https://mcp.alphavantage.co/)
2. Look up a stock price or trend
3. Return a graphical UI displaying the financial data
4. Be tested through chatgpt-app-sim with Claude Chrome integration

---

## What's In vs Out

| Feature | Status | Reason |
|---------|--------|--------|
| Stdio transport | ✅ IN | For spawning local MCP servers |
| SSE transport | ✅ IN | For HTTP-based MCP servers (like Alpha Vantage) |
| Multi-provider LLM | ✅ IN | Vercel AI SDK (Anthropic, OpenAI, etc.) |
| Filesystem cache | ✅ IN | Avoid cold starts on restart |
| `_ui_refine` tool | ✅ IN | Core refinement feature |
| `_ui_regenerate` tool | ✅ IN | Force regeneration |
| Tool classification | ❌ OUT | Always try rich, fallback to minimal |
| HTML repair logic | ❌ OUT | Just fallback on validation failure |
| `_ui_inspect`, `_ui_list` | ❌ OUT | Nice debugging, not essential |
| Config file support | ❌ OUT | CLI args + env vars only |
| Elaborate logging | ❌ OUT | Basic console output |
| Concurrency control | ❌ OUT | Single-user, sequential is fine |

---

## Architecture

```
┌─────────────────────┐
│  chatgpt-app-sim    │  (Testing UI)
│  localhost:3000     │
└─────────┬───────────┘
          │ HTTP
          ▼
┌─────────────────────┐
│  MCP Gen-UI Wrapper │  (This project)
│  localhost:8000     │
│                     │
│  • Adds ui:// URIs  │
│  • Generates HTML   │
│  • Caches results   │
└─────────┬───────────┘
          │ SSE
          ▼
┌─────────────────────┐
│  Alpha Vantage MCP  │
│  mcp.alphavantage.co│
└─────────────────────┘
```

---

## Implementation Tasks

### Task 1: Project Setup (~30 min)
- TypeScript project with esbuild
- Dependencies: MCP SDK, Vercel AI SDK, commander
- Basic vitest setup

**Files:**
- `package.json`
- `tsconfig.json`
- `vitest.config.ts`

### Task 2: Transport Layer (~2 hours)
- Base transport interface
- **Stdio**: Spawn subprocess, JSON-RPC framing, partial message handling
- **SSE**: HTTP connection, reconnection with exponential backoff

**Files:**
- `src/transport/base.ts`
- `src/transport/stdio.ts`
- `src/transport/sse.ts`

### Task 3: MCP Server Shell (~1-2 hours)
- Use @modelcontextprotocol/sdk Server
- Handle: initialize, tools/list, tools/call, resources/list, resources/read
- Add `_meta.ui.resourceUri` to tool definitions
- Implement `_ui_refine` and `_ui_regenerate` wrapper tools

**Files:**
- `src/server.ts`

### Task 4: LLM Integration (~1 hour)
- Vercel AI SDK with provider selection
- Support ANTHROPIC_API_KEY, OPENAI_API_KEY env vars
- Model selection via CLI flag

**Files:**
- `src/llm.ts`

### Task 5: UI Generation (~2-3 hours)
- Prompt templates (system + user)
- 15s timeout with fallback
- Minimal UI template for failures
- Basic HTML validation (App API import present, no external scripts)

**Files:**
- `src/generator.ts`
- `src/prompts/system.txt`
- `src/prompts/generate.txt`

### Task 6: Cache with Persistence (~1-2 hours)
- In-memory LRU cache
- Cache key: tool name + schema hash + refinement hash
- Filesystem persistence (JSON file)
- Load on startup, save on change

**Files:**
- `src/cache.ts`

### Task 7: CLI (~30 min)
- `--upstream "command args"` for stdio
- `--upstream-url "http://..."` for SSE
- `--provider anthropic|openai`
- `--model` override
- `--cache-dir` for persistence

**Files:**
- `src/index.ts`
- `src/config.ts`

---

## File Structure

```
src/
├── index.ts              # Entry point + CLI
├── config.ts             # Config from CLI args + env
├── transport/
│   ├── base.ts           # Transport interface
│   ├── stdio.ts          # Stdio transport
│   └── sse.ts            # SSE transport
├── server.ts             # MCP server wrapper
├── llm.ts                # Vercel AI SDK wrapper
├── generator.ts          # UI generation + fallback
├── cache.ts              # In-memory + filesystem cache
└── prompts/
    ├── system.txt        # System prompt
    └── generate.txt      # Generation template
```

---

## Dependencies

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "ai": "^3.0.0",
    "@ai-sdk/anthropic": "^0.0.30",
    "@ai-sdk/openai": "^0.0.30",
    "commander": "^12.0.0",
    "eventsource": "^2.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "esbuild": "^0.20.0",
    "typescript": "^5.4.0",
    "vitest": "^1.3.0"
  }
}
```

---

## Testing Strategy

### Test Target: Alpha Vantage MCP Server

- **URL:** https://mcp.alphavantage.co/
- **API Key:** `pass dev/ALPHA_VANTAGE_API_KEY`
- **Test tools:** Stock quotes, price history, trends

### Test Environment: chatgpt-app-sim

Located at `~/repos/gh/chatgpt-app-sim/`

```bash
# 1. Start the wrapper pointing to Alpha Vantage
ANTHROPIC_API_KEY=$(pass API_KEYS/anthropic) \
ALPHA_VANTAGE_API_KEY=$(pass dev/ALPHA_VANTAGE_API_KEY) \
npm run start -- --upstream-url "https://mcp.alphavantage.co/" --port 8000

# 2. Start chatgpt-app-sim connected to the wrapper
chatgpt-app-sim --mcp-url http://localhost:8000 --port 3000

# 3. Open http://localhost:3000 in browser
# 4. Use Claude Chrome integration to interact
```

### Verification Steps

1. `npm run build` succeeds
2. Wrapper starts and connects to Alpha Vantage
3. chatgpt-app-sim shows tools with `_meta.ui.resourceUri`
4. Request stock quote tool → see generated HTML UI
5. UI displays actual stock price data graphically
6. Restart wrapper → cache loads from disk (fast response)
7. Call `_ui_refine("add a chart")` → UI regenerates with chart

---

## Example Usage

```bash
# SSE transport to Alpha Vantage
ANTHROPIC_API_KEY=sk-xxx \
ALPHA_VANTAGE_API_KEY=xxx \
npx mcp-gen-ui --upstream-url "https://mcp.alphavantage.co/"

# Stdio transport to local server
ANTHROPIC_API_KEY=sk-xxx \
npx mcp-gen-ui --upstream "node weather-server.js"

# Use OpenAI instead
OPENAI_API_KEY=sk-xxx \
npx mcp-gen-ui --upstream-url "https://mcp.alphavantage.co/" --provider openai

# Custom cache directory
npx mcp-gen-ui --upstream-url "..." --cache-dir ~/.cache/mcp-gen-ui
```

---

## Deferred to v1.1+

- Tool classification (rich vs minimal heuristics)
- HTML repair logic
- `_ui_inspect`, `_ui_list`, `_ui_refresh_tools` tools
- Config file support (YAML/JSON)
- Elaborate logging (correlation IDs, redaction)
- Concurrency control for parallel generations
- Multiple server composition
