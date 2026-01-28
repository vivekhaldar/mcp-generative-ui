# MCP Generative UI Wrapper - Product Specification

**Version:** 1.0
**Author:** Vivek Haldar
**Date:** 2026-01-28
**Status:** Draft

---

## Executive Summary

MCP Generative UI Wrapper is a proxy layer that wraps any "plain" MCP server (tools-only) and automatically generates interactive UI resources using an LLM at runtime. This enables rapid prototyping of MCP Apps from existing tool-based MCP servers without modifying the underlying server.

The wrapper intercepts tool definitions, generates corresponding UI components on-demand, caches them for performance, and supports iterative refinement through natural language feedback in the conversation.

---

## Problem Statement

MCP servers today expose tools that LLMs can invoke, but the interaction is purely text-based. The new MCP Apps specification allows servers to provide rich interactive UIs rendered in conversation. However:

1. **Existing MCP servers lack UI** - There's a large ecosystem of plain tool-only MCP servers
2. **Building UIs is time-consuming** - Creating bespoke UIs for each tool requires frontend development effort
3. **Prototyping friction** - No way to quickly explore "what would this tool look like as an app?"

---

## Goals

1. **Zero-config UI generation** - Point the wrapper at any MCP server, get interactive UIs automatically
2. **On-demand generation with caching** - Generate UIs when first requested, cache for subsequent requests
3. **Iterative refinement** - Users can request UI changes via natural language; wrapper regenerates accordingly
4. **Full interactivity** - Generated UIs should call tools, update dynamically, handle user input
5. **Transparent proxying** - All original tool functionality preserved; wrapper is invisible to the underlying server

## Non-Goals

1. **Production-grade UIs** - This is for prototyping/exploration, not pixel-perfect production apps
2. **Custom framework support** - Generated UIs use vanilla HTML/JS/CSS, not React/Vue/etc.
3. **Persistent UI customizations** - Refinements are session-scoped (future versions may persist)
4. **Multi-server composition** - V1 wraps a single MCP server (dashboards across servers is future work)

---

## User Stories

### US-1: Quick Prototyping
> As a developer with an existing MCP server, I want to see what it would look like as an MCP App without writing any frontend code.

### US-2: Iterative Design
> As a developer prototyping a UI, I want to say "make the table sortable" or "use a dark theme" and have the UI regenerate with my feedback incorporated.

### US-3: Tool Exploration
> As a user interacting with an MCP App, I want the UI to let me call tools with different parameters and see results update in real-time.

### US-4: Graceful Degradation
> As a user, when a tool doesn't have a meaningful visual representation, I want to see a minimal but functional UI rather than an error.

---

## Functional Requirements

### FR-1: MCP Server Wrapping

| ID | Requirement |
|----|-------------|
| FR-1.1 | Wrapper MUST connect to any MCP server via stdio or SSE transport |
| FR-1.2 | Wrapper MUST enumerate all tools from the underlying server at startup |
| FR-1.3 | Wrapper MUST expose all underlying tools with identical schemas |
| FR-1.4 | Wrapper MUST add `_meta.ui.resourceUri` to each exposed tool pointing to a generated UI resource |
| FR-1.5 | Wrapper MUST proxy all tool invocations to the underlying server transparently |
| FR-1.6 | Wrapper MUST forward tool results back to the caller without modification |

### FR-2: UI Resource Generation

| ID | Requirement |
|----|-------------|
| FR-2.1 | Wrapper MUST serve UI resources at `ui://{tool-name}` for each tool |
| FR-2.2 | UI generation MUST be triggered on first request for a resource (on-demand) |
| FR-2.3 | Generated UIs MUST be cached after first generation |
| FR-2.4 | Cache MUST be invalidated if underlying tool schema changes |
| FR-2.5 | Generated UIs MUST use the `@modelcontextprotocol/ext-apps` App API |
| FR-2.6 | Generated UIs MUST be self-contained (single HTML file with inline JS/CSS) |

### FR-3: LLM-Powered Generation

| ID | Requirement |
|----|-------------|
| FR-3.1 | Wrapper MUST use an LLM to generate UI code given tool metadata |
| FR-3.2 | Generation context MUST include: tool name, description, input schema |
| FR-3.3 | Generation context SHOULD include: output schema (if available), example outputs |
| FR-3.4 | Generated UI MUST handle the `ontoolresult` callback to render tool outputs |
| FR-3.5 | Generated UI SHOULD provide input forms to invoke the tool with new parameters |
| FR-3.6 | Generated UI SHOULD call `app.callServerTool()` for follow-up interactions |

### FR-4: Iterative Refinement

| ID | Requirement |
|----|-------------|
| FR-4.1 | Wrapper MUST accept refinement feedback associated with a specific tool's UI |
| FR-4.2 | Refinement feedback MUST be incorporated into the generation prompt |
| FR-4.3 | Refined UI MUST replace the cached version for subsequent requests |
| FR-4.4 | Refinement history MUST be preserved for the session to enable cumulative changes |
| FR-4.5 | Wrapper MUST expose a mechanism for the host to submit refinement requests |

### FR-5: Minimal/Fallback UIs

| ID | Requirement |
|----|-------------|
| FR-5.1 | Tools without meaningful visual output MUST still receive a minimal UI |
| FR-5.2 | Minimal UI MUST display: tool name, description, input form, raw JSON output |
| FR-5.3 | LLM SHOULD determine if a tool warrants rich UI or minimal UI based on its purpose |
| FR-5.4 | Users MAY override and request rich UI generation for any tool |

### FR-6: Error Handling

| ID | Requirement |
|----|-------------|
| FR-6.1 | Generated UIs MUST include try/catch error boundaries around rendering logic |
| FR-6.2 | UI errors MUST be displayed inline with error details and raw data fallback |
| FR-6.3 | If UI generation fails, wrapper MUST serve a fallback minimal UI |
| FR-6.4 | Tool invocation errors MUST be displayed in the UI with actionable messages |
| FR-6.5 | Wrapper MUST log all generation and runtime errors for debugging |

---

## Technical Requirements

### TR-1: Performance

| ID | Requirement |
|----|-------------|
| TR-1.1 | Cached UI resources MUST be served in <50ms |
| TR-1.2 | Initial UI generation MAY take up to 10 seconds (LLM latency acceptable) |
| TR-1.3 | Tool proxying MUST add <10ms overhead |
| TR-1.4 | Wrapper startup (tool enumeration) MUST complete in <5 seconds |

### TR-2: Caching

| ID | Requirement |
|----|-------------|
| TR-2.1 | Cache MUST be keyed by: tool name + schema hash + refinement history hash |
| TR-2.2 | Cache MUST support in-memory storage (default) |
| TR-2.3 | Cache SHOULD support optional filesystem persistence |
| TR-2.4 | Cache entries MUST include: generated HTML, generation timestamp, source context |

### TR-3: LLM Integration

| ID | Requirement |
|----|-------------|
| TR-3.1 | Wrapper MUST support configurable LLM provider (Anthropic, OpenAI, local) |
| TR-3.2 | LLM API credentials MUST be provided via environment variables or config |
| TR-3.3 | Generation prompts MUST be version-controlled and updatable without code changes |
| TR-3.4 | Wrapper SHOULD support streaming generation for progress feedback |

### TR-4: Transport & Protocol

| ID | Requirement |
|----|-------------|
| TR-4.1 | Wrapper MUST support stdio transport for underlying server connection |
| TR-4.2 | Wrapper MUST support SSE transport for underlying server connection |
| TR-4.3 | Wrapper MUST expose itself as a valid MCP server (stdio or SSE) |
| TR-4.4 | Wrapper MUST implement MCP Apps resource serving for `ui://` scheme |

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          MCP Host                                   │
│                    (Claude Desktop, etc.)                           │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ MCP Protocol (stdio/SSE)
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   Generative UI MCP Wrapper                         │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                      MCP Server Interface                     │  │
│  │  - Exposes tools (with ui:// metadata added)                  │  │
│  │  - Serves ui:// resources                                     │  │
│  │  - Handles refinement requests                                │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                               │                                     │
│         ┌─────────────────────┼─────────────────────┐               │
│         ▼                     ▼                     ▼               │
│  ┌─────────────┐    ┌─────────────────┐    ┌─────────────────┐     │
│  │ Tool Proxy  │    │  UI Generator   │    │  Cache Manager  │     │
│  │             │    │                 │    │                 │     │
│  │ - Forward   │    │ - LLM client    │    │ - In-memory     │     │
│  │   calls     │    │ - Prompt mgmt   │    │ - File persist  │     │
│  │ - Schema    │    │ - Refinement    │    │ - Invalidation  │     │
│  │   tracking  │    │   history       │    │                 │     │
│  └──────┬──────┘    └─────────────────┘    └─────────────────┘     │
│         │                                                           │
└─────────┼───────────────────────────────────────────────────────────┘
          │ MCP Protocol (stdio/SSE)
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Underlying MCP Server                            │
│                      (Plain, tools-only)                            │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Data Models

### Tool Registry Entry

```typescript
interface ToolRegistryEntry {
  // Original tool definition from underlying server
  original: {
    name: string;
    description: string;
    inputSchema: JSONSchema;
  };

  // Computed metadata
  schemaHash: string;              // SHA-256 of JSON.stringify(inputSchema)
  inferredOutputSchema?: JSONSchema;  // If we can infer it

  // UI generation state
  uiResourceUri: string;           // e.g., "ui://tool-name"
  uiType: "rich" | "minimal";      // LLM-determined or user-overridden

  // Refinement state (session-scoped)
  refinementHistory: RefinementEntry[];
}
```

### Refinement Entry

```typescript
interface RefinementEntry {
  timestamp: Date;
  feedback: string;                // Natural language feedback
  appliedToGeneration: string;     // Hash of the generation it affected
}
```

### Cache Entry

```typescript
interface CacheEntry {
  key: string;                     // tool-name:schema-hash:refinement-hash

  // Generated content
  html: string;                    // Complete self-contained HTML

  // Metadata
  generatedAt: Date;
  generationDurationMs: number;
  llmModel: string;
  promptVersion: string;

  // Context used for generation (for debugging/regeneration)
  generationContext: UIGenerationContext;
}
```

### UI Generation Context

```typescript
interface UIGenerationContext {
  tool: {
    name: string;
    description: string;
    inputSchema: JSONSchema;
    outputSchema?: JSONSchema;
  };

  refinementHistory: string[];     // Ordered list of feedback strings

  hints?: {
    uiType?: "chart" | "table" | "form" | "card" | "list" | "map" | "timeline";
    theme?: "light" | "dark" | "system";
    interactivity?: "readonly" | "interactive";
  };

  examples?: {
    input: any;
    output: any;
  }[];
}
```

---

## API Design

### Wrapper Configuration

```typescript
interface WrapperConfig {
  // Underlying server connection
  upstream: {
    transport: "stdio" | "sse";
    command?: string;              // For stdio: command to spawn
    args?: string[];               // For stdio: command arguments
    url?: string;                  // For SSE: server URL
  };

  // LLM configuration
  llm: {
    provider: "anthropic" | "openai" | "ollama";
    model: string;
    apiKey?: string;               // Or use env var
    baseUrl?: string;              // For custom endpoints
  };

  // Cache configuration
  cache: {
    type: "memory" | "filesystem";
    directory?: string;            // For filesystem cache
    maxEntries?: number;           // LRU eviction threshold
  };

  // Generation defaults
  generation: {
    defaultTheme: "light" | "dark" | "system";
    promptsDirectory?: string;     // Custom prompts location
  };
}
```

### Refinement API

The wrapper exposes a special tool for UI refinement:

```typescript
// Exposed as an MCP tool
{
  name: "_ui_refine",
  description: "Refine the generated UI for a tool based on feedback",
  inputSchema: {
    type: "object",
    properties: {
      toolName: {
        type: "string",
        description: "Name of the tool whose UI should be refined"
      },
      feedback: {
        type: "string",
        description: "Natural language description of desired changes"
      }
    },
    required: ["toolName", "feedback"]
  }
}
```

**Example refinement flow:**

1. User says: "Make the chart use a dark theme and add axis labels"
2. Host calls `_ui_refine` with `{ toolName: "get_stock_prices", feedback: "..." }`
3. Wrapper appends feedback to refinement history
4. Wrapper regenerates UI with cumulative refinement context
5. Wrapper invalidates cache, stores new generation
6. Next `ui://get_stock_prices` request returns refined UI

### Introspection API

Additional tools for debugging/exploration:

```typescript
// List all wrapped tools and their UI status
{
  name: "_ui_list",
  description: "List all tools and their UI generation status",
  inputSchema: { type: "object", properties: {} }
}

// Get generation details for a tool
{
  name: "_ui_inspect",
  description: "Get UI generation details for a specific tool",
  inputSchema: {
    type: "object",
    properties: {
      toolName: { type: "string" }
    },
    required: ["toolName"]
  }
}

// Force regeneration (ignore cache)
{
  name: "_ui_regenerate",
  description: "Force regeneration of UI for a tool",
  inputSchema: {
    type: "object",
    properties: {
      toolName: { type: "string" }
    },
    required: ["toolName"]
  }
}
```

---

## UI Generation Prompt Strategy

### System Prompt (Condensed)

```
You are a UI generator for MCP Apps. Given a tool definition, generate a self-contained
HTML file that:

1. Uses the @modelcontextprotocol/ext-apps App API
2. Handles ontoolresult to render tool outputs
3. Provides input forms to invoke the tool with new parameters
4. Calls app.callServerTool() for interactivity
5. Includes comprehensive error handling
6. Is visually clean and functional

Output ONLY the HTML file, no explanation.
```

### Generation Prompt Template

```
Generate a UI for this MCP tool:

**Tool Name:** {{tool.name}}
**Description:** {{tool.description}}

**Input Schema:**
```json
{{tool.inputSchema}}
```

{{#if tool.outputSchema}}
**Output Schema:**
```json
{{tool.outputSchema}}
```
{{/if}}

{{#if examples}}
**Example Output:**
```json
{{examples[0].output}}
```
{{/if}}

{{#if refinementHistory}}
**User Refinement Requests (apply all of these):**
{{#each refinementHistory}}
- {{this}}
{{/each}}
{{/if}}

**Requirements:**
- Self-contained HTML with inline <script> and <style>
- Use App API from @modelcontextprotocol/ext-apps
- Handle ontoolresult callback to render results
- Include form to call tool with new inputs
- Add error boundaries with user-friendly messages
- Theme: {{hints.theme || "light"}}
- Make it interactive and useful
```

### Minimal UI Template

For tools that don't warrant rich visualization:

```html
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: system-ui; padding: 20px; max-width: 800px; margin: 0 auto; }
    .tool-name { font-size: 1.5em; font-weight: bold; margin-bottom: 8px; }
    .tool-desc { color: #666; margin-bottom: 20px; }
    .form-group { margin-bottom: 16px; }
    label { display: block; font-weight: 500; margin-bottom: 4px; }
    input, textarea { width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; }
    button { background: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; }
    button:hover { background: #0056b3; }
    .result { margin-top: 20px; padding: 16px; background: #f5f5f5; border-radius: 4px; }
    .result pre { margin: 0; white-space: pre-wrap; word-break: break-word; }
    .error { background: #fee; border: 1px solid #fcc; padding: 12px; border-radius: 4px; color: #c00; }
  </style>
</head>
<body>
  <div class="tool-name">{{tool.name}}</div>
  <div class="tool-desc">{{tool.description}}</div>

  <form id="tool-form">
    <!-- Generated form fields based on inputSchema -->
  </form>

  <div id="result" class="result" style="display: none;">
    <strong>Result:</strong>
    <pre id="result-content"></pre>
  </div>

  <div id="error" class="error" style="display: none;"></div>

  <script type="module">
    import { App } from "@modelcontextprotocol/ext-apps";

    const app = new App();
    await app.connect();

    app.ontoolresult = (result) => {
      document.getElementById('result').style.display = 'block';
      document.getElementById('error').style.display = 'none';
      document.getElementById('result-content').textContent = JSON.stringify(result, null, 2);
    };

    document.getElementById('tool-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const formData = new FormData(e.target);
        const args = Object.fromEntries(formData);
        await app.callServerTool({ name: "{{tool.name}}", arguments: args });
      } catch (err) {
        document.getElementById('error').style.display = 'block';
        document.getElementById('error').textContent = err.message;
      }
    });
  </script>
</body>
</html>
```

---

## Error Handling Strategy

### Generation Errors

| Error | Handling |
|-------|----------|
| LLM API timeout | Retry once, then serve minimal UI with error note |
| LLM returns invalid HTML | Attempt to fix with follow-up prompt, else serve minimal UI |
| LLM returns HTML without App API | Inject App API boilerplate, serve with warning |
| Rate limiting | Queue request, serve "generating..." placeholder |

### Runtime Errors (in generated UI)

All generated UIs include this error boundary pattern:

```javascript
window.onerror = (msg, url, line, col, error) => {
  document.body.innerHTML = `
    <div style="padding: 20px; font-family: system-ui;">
      <h2 style="color: #c00;">UI Error</h2>
      <p>${msg}</p>
      <details>
        <summary>Raw tool result</summary>
        <pre id="raw-result"></pre>
      </details>
    </div>
  `;
  // Still try to show raw data
  if (window.__lastToolResult) {
    document.getElementById('raw-result').textContent =
      JSON.stringify(window.__lastToolResult, null, 2);
  }
};

// Store results for error recovery
app.ontoolresult = (result) => {
  window.__lastToolResult = result;
  try {
    renderResult(result);
  } catch (e) {
    window.onerror(e.message, '', 0, 0, e);
  }
};
```

### Proxy Errors

| Error | Handling |
|-------|----------|
| Underlying server unreachable | Return MCP error, UI shows connection error state |
| Tool invocation fails | Forward error to UI, display with retry option |
| Schema mismatch (server changed) | Invalidate cache, regenerate UI, log warning |

---

## Security Considerations

### LLM Output Sandboxing

1. Generated UIs run in sandboxed iframes (per MCP Apps spec)
2. Wrapper SHOULD validate generated HTML doesn't include:
   - External script sources (only allow CDN for ext-apps)
   - Inline event handlers that bypass the sandbox
   - Attempts to access parent frame

### Prompt Injection

1. Tool names/descriptions from underlying server are untrusted input
2. Generation prompt MUST escape/sanitize tool metadata
3. Consider: malicious tool description could inject prompt instructions

### Credential Handling

1. LLM API keys stored in environment variables, not config files
2. Underlying server credentials handled by standard MCP mechanisms
3. No credentials ever included in generated UI code

---

## Observability & Debugging

### Logging

```
[INFO]  Wrapper started, connected to upstream: my-mcp-server
[INFO]  Discovered 5 tools: [list_items, get_item, create_item, update_item, delete_item]
[DEBUG] UI requested for tool: get_item (cache miss)
[INFO]  Generating UI for get_item (context: 1.2KB, refinements: 0)
[DEBUG] LLM generation completed in 3420ms
[INFO]  Cached UI for get_item (key: get_item:a1b2c3:d4e5f6)
[DEBUG] UI requested for tool: get_item (cache hit)
[INFO]  Refinement requested for list_items: "add pagination controls"
[DEBUG] Regenerating UI with 1 refinement(s)
```

### Metrics (Future)

- UI generation latency (p50, p95, p99)
- Cache hit rate
- Refinement frequency per tool
- Error rates by category

---

## Future Considerations (Out of Scope for V1)

1. **Persistent refinements** - Save refinements to disk, reload on restart
2. **UI templates** - User-provided base templates for consistent styling
3. **Multi-server dashboards** - Compose UIs across multiple MCP servers
4. **Export to code** - Export generated UI as standalone file for manual refinement
5. **A/B generation** - Generate multiple UI variants, let user pick
6. **Output schema inference** - Call tool with sample inputs to infer output shape
7. **Collaborative refinement** - Multiple users refining same tool's UI
8. **Version history** - Track and rollback UI versions

---

## Appendix A: Example Walkthrough

### Scenario: Wrapping a Weather MCP Server

**Underlying server tools:**
- `get_current_weather(location: string)` → `{ temp, conditions, humidity, wind }`
- `get_forecast(location: string, days: number)` → `[{ date, high, low, conditions }]`
- `set_units(unit: "celsius" | "fahrenheit")` → `{ success: boolean }`

**Wrapper behavior:**

1. **Startup:** Connects to weather server, discovers 3 tools
2. **Tool exposure:** All 3 tools exposed with `_meta.ui.resourceUri` added
3. **First UI request:** Host requests `ui://get_forecast`
4. **Generation:** LLM generates interactive forecast UI with:
   - Location input field
   - Days slider (1-14)
   - "Get Forecast" button
   - Forecast display as cards/chart
5. **Caching:** UI cached with key `get_forecast:{schema-hash}:{empty-refinements}`
6. **Refinement:** User says "show forecast as a line chart instead of cards"
7. **Regeneration:** LLM regenerates with refinement, cache updated
8. **Minimal UI:** `set_units` gets minimal UI (just a toggle and success message)

---

## Appendix B: CLI Interface (Proposed)

```bash
# Basic usage
mcp-gen-ui --upstream "node weather-server.js" --llm anthropic

# With config file
mcp-gen-ui --config ./wrapper-config.json

# Debug mode (verbose logging, no cache)
mcp-gen-ui --upstream "..." --debug --no-cache

# Export generated UIs to files
mcp-gen-ui --upstream "..." --export-dir ./generated-uis
```

---

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-01-28 | Initial draft |
