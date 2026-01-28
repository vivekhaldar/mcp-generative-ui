# MCP Generative UI Wrapper - Technical Design Document

**Version:** 1.0
**Author:** Vivek Haldar
**Date:** 2026-01-28
**Status:** Draft
**Companion Document:** [PRODUCT_SPEC.md](./PRODUCT_SPEC.md)

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Problem Analysis](#2-problem-analysis)
3. [Design Alternatives Considered](#3-design-alternatives-considered)
4. [Detailed Design](#4-detailed-design)
5. [Component Breakdown](#5-component-breakdown)
6. [Data Models and Schemas](#6-data-models-and-schemas)
7. [API Interfaces](#7-api-interfaces)
8. [UI Generation Pipeline](#8-ui-generation-pipeline)
9. [Error Handling Strategy](#9-error-handling-strategy)
10. [Security Considerations](#10-security-considerations)
11. [Observability](#11-observability)
12. [Concrete Examples](#12-concrete-examples)
13. [Implementation Task Breakdown](#13-implementation-task-breakdown)

---

## 1. Introduction

### 1.1 Purpose

This document describes the technical design for the MCP Generative UI Wrapper, a proxy layer that automatically generates interactive UIs for plain MCP tool servers using LLM-powered code generation.

### 1.2 Background: MCP Apps Specification

The MCP (Model Context Protocol) Apps extension enables MCP servers to provide rich interactive UIs that render within the conversation. Key concepts:

- **Tool-UI Linkage**: Tools declare UI resources via `_meta.ui.resourceUri` pointing to a `ui://` URI
- **Sandboxed Rendering**: UIs run in isolated iframes with controlled communication
- **Client API**: The `@modelcontextprotocol/ext-apps` package provides an `App` class with:
  - `app.connect()` - Establish connection with host
  - `app.ontoolresult` - Callback receiving tool execution results
  - `app.callServerTool()` - Invoke tools from the UI
- **Result Flow**: Host → Server (tool call) → Host (receives result) → UI (via `ontoolresult`)

### 1.3 Scope

This design covers V1 of the wrapper, which:
- Wraps a single MCP server
- Generates UIs on-demand with LLM
- Caches generated UIs in-memory (with optional filesystem persistence)
- Supports session-scoped iterative refinement
- Implements both stdio and SSE transports

---

## 2. Problem Analysis

### 2.1 The Gap We're Addressing

The MCP ecosystem has a chicken-and-egg problem:

1. **Existing servers are text-only**: Hundreds of MCP servers expose tools, but none provide UIs
2. **UI development is orthogonal to tool development**: A developer building a database query tool may not have frontend skills
3. **Exploration is blocked**: Users can't visualize what a tool *would* look like as an app without building it

### 2.2 Why This Approach

The wrapper creates a zero-friction path from "I have tools" to "I have interactive UIs" by:

1. **Leveraging LLM code generation**: Modern LLMs can generate functional HTML/JS/CSS from descriptions
2. **Using tool schemas as specifications**: The JSON Schema input definition + description provides enough context for UI generation
3. **Allowing iterative refinement**: Natural language feedback enables non-developers to customize UIs

### 2.3 Key Constraints

| Constraint | Implication |
|-----------|-------------|
| Generated UIs must be self-contained | Single HTML file with inline JS/CSS; no build step |
| LLM generation has latency | Cache aggressively; accept 3-10s for first generation |
| Tool schemas are the only contract | Cannot assume anything about output structure |
| Security sandbox limits capabilities | No access to cookies, localStorage, parent frame |

---

## 3. Design Alternatives Considered

### 3.1 Static Template Library

**Approach**: Maintain a library of UI templates for common tool patterns (table, chart, form, card). Map tools to templates heuristically.

**Pros**:
- No LLM latency
- Predictable output quality
- No API costs

**Cons**:
- Limited to predefined patterns
- No customization without code changes
- Doesn't handle novel tool shapes

**Verdict**: Rejected. Too inflexible for the "zero-config" goal. However, we'll use templates as fallback for minimal UIs.

### 3.2 Schema-to-UI Compiler

**Approach**: Build a deterministic compiler that converts JSON Schema → form controls, and infers output visualization from response structure.

**Pros**:
- Fast, deterministic
- No external dependencies

**Cons**:
- Input forms are easy; output visualization requires understanding *meaning*
- A `get_user` and `get_weather` might have identical schemas but need different UIs
- No way to handle refinement requests

**Verdict**: Rejected. The semantic gap between schema and visualization requires LLM intelligence.

### 3.3 Hybrid: LLM + Template Injection

**Approach**: Use templates as scaffolding, have LLM fill in rendering logic only.

**Pros**:
- Reduces LLM output variability
- Consistent error handling, styling
- Smaller prompts = faster generation

**Cons**:
- Still requires LLM for the hard part (output rendering)
- Templates add complexity

**Verdict**: Adopted partially. We use a "minimal UI template" as fallback and inject standard error handling patterns into the generation prompt.

### 3.4 Pre-generation at Startup

**Approach**: Generate all UIs when the wrapper starts, before any requests.

**Pros**:
- No latency on first request
- Can validate all UIs upfront

**Cons**:
- Slow startup (N tools × 5s = minutes)
- Wasteful if many tools are never used
- Blocks wrapper from being ready quickly

**Verdict**: Rejected. On-demand generation with caching provides better user experience.

### 3.5 Streaming UI Generation

**Approach**: Stream partial HTML as the LLM generates, showing progressive rendering.

**Pros**:
- Better perceived latency
- User sees progress

**Cons**:
- Partial HTML is invalid HTML; can't render incrementally
- Complex state management
- MCP resource serving doesn't support streaming

**Verdict**: Deferred. V1 will show a "Generating UI..." placeholder, then swap in the complete UI.

---

## 4. Detailed Design

### 4.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              MCP Host                                        │
│                       (Claude Desktop, etc.)                                 │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │ MCP Protocol (stdio or SSE)
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Generative UI Wrapper                                   │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                        MCP Server Interface                            │ │
│  │                                                                        │ │
│  │  • Implements MCP protocol (Server class from @modelcontextprotocol)   │ │
│  │  • Handles tools/list, tools/call, resources/read                      │ │
│  │  • Adds _meta.ui.resourceUri to all tool definitions                   │ │
│  │  • Exposes wrapper introspection tools (_ui_*)                         │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                  │                                           │
│        ┌─────────────────────────┼─────────────────────────┐                │
│        │                         │                         │                │
│        ▼                         ▼                         ▼                │
│  ┌───────────────┐    ┌───────────────────┐    ┌───────────────────┐       │
│  │  Tool Proxy   │    │   UI Generator    │    │   Cache Manager   │       │
│  │               │    │                   │    │                   │       │
│  │ • Forward     │    │ • Prompt builder  │    │ • LRU eviction    │       │
│  │   tools/call  │    │ • LLM client      │    │ • Key computation │       │
│  │ • Track       │    │ • HTML validator  │    │ • Schema hashing  │       │
│  │   schemas     │    │ • Error recovery  │    │ • File persist    │       │
│  └───────┬───────┘    │ • Refinement      │    │   (optional)      │       │
│          │            │   accumulator     │    └───────────────────┘       │
│          │            └───────────────────┘                                 │
│          │                                                                   │
└──────────┼───────────────────────────────────────────────────────────────────┘
           │ MCP Protocol (stdio or SSE)
           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Underlying MCP Server                                │
│                           (Plain, tools-only)                                │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Request Flow Diagrams

#### 4.2.1 Tool Discovery (Startup)

```
Wrapper                          Underlying Server
   │                                    │
   │──── tools/list ───────────────────>│
   │                                    │
   │<─── [tool1, tool2, tool3] ─────────│
   │                                    │
   │  For each tool:                    │
   │  • Compute schema hash             │
   │  • Create registry entry           │
   │  • Assign ui://tool-name URI       │
   │                                    │
```

#### 4.2.2 Tool Call (Proxied)

```
Host               Wrapper                 Underlying Server
  │                   │                           │
  │─ tools/call ─────>│                           │
  │   {name, args}    │                           │
  │                   │── tools/call ────────────>│
  │                   │                           │
  │                   │<── result ────────────────│
  │                   │                           │
  │<── result ────────│                           │
  │                   │                           │
```

#### 4.2.3 UI Resource Request (Cache Miss)

```
Host               Wrapper                    LLM API
  │                   │                          │
  │─ resources/read ─>│                          │
  │   ui://tool-name  │                          │
  │                   │                          │
  │                   │  Cache lookup: MISS      │
  │                   │                          │
  │                   │─ Build prompt ──────────>│
  │                   │   (tool metadata)        │
  │                   │                          │
  │                   │<── generated HTML ───────│
  │                   │                          │
  │                   │  Validate HTML           │
  │                   │  Store in cache          │
  │                   │                          │
  │<── HTML resource ─│                          │
  │                   │                          │
```

#### 4.2.4 Refinement Request

```
Host               Wrapper                    LLM API
  │                   │                          │
  │─ tools/call ─────>│                          │
  │   _ui_refine      │                          │
  │   {toolName,      │                          │
  │    feedback}      │                          │
  │                   │                          │
  │                   │  Append to refinement    │
  │                   │  history                 │
  │                   │                          │
  │                   │  Invalidate cache        │
  │                   │                          │
  │                   │─ Build prompt ──────────>│
  │                   │   (tool + history)       │
  │                   │                          │
  │                   │<── regenerated HTML ─────│
  │                   │                          │
  │                   │  Store new cache entry   │
  │                   │                          │
  │<── {success} ─────│                          │
  │                   │                          │
```

### 4.3 Key Design Decisions

#### 4.3.1 On-Demand Generation with Blocking

When a UI resource is first requested, we generate synchronously and block the response. This is acceptable because:

1. MCP resource reads can take time (the protocol doesn't assume instant responses)
2. LLM generation typically completes in 3-10 seconds
3. Subsequent requests hit cache (<50ms)

Alternative considered: Return a "loading" placeholder immediately, generate async, require client to poll. Rejected because it complicates client logic and the MCP host may not support it gracefully.

#### 4.3.2 Refinement via Tool Call

Refinement is exposed as an MCP tool (`_ui_refine`) rather than a separate API because:

1. Tools are the standard way MCP clients interact with servers
2. The host LLM can invoke refinement in response to user requests
3. No protocol extensions required

#### 4.3.3 Cache Key Design

Cache keys must uniquely identify the generation context:

```
key = hash(tool_name + schema_hash + refinement_hash)
```

Where:
- `schema_hash = SHA256(JSON.stringify(inputSchema))`
- `refinement_hash = SHA256(refinements.join('|'))`

This ensures:
- Schema changes invalidate cache automatically
- Each refinement sequence produces a unique cache entry
- Same tool with same refinements always hits cache

#### 4.3.4 Minimal UI as Fallback

Every generation failure path leads to the minimal UI template. This guarantees:

1. Users always see *something* functional
2. Raw JSON output is always accessible
3. Tool invocation still works

---

## 5. Component Breakdown

### 5.1 MCP Server Interface

**Responsibility**: Implement the MCP protocol facing the host.

**Key Operations**:

| Operation | Handler |
|-----------|---------|
| `initialize` | Return server info + capabilities |
| `tools/list` | Return upstream tools + wrapper tools, with `_meta.ui` added |
| `tools/call` | Route to ToolProxy or handle wrapper tools locally |
| `resources/list` | Return `ui://` resources for all tools |
| `resources/read` | Trigger UIGenerator or return cached HTML |

**Implementation Notes**:

```typescript
// Pseudo-code for tools/list handler
async function handleToolsList(): Promise<Tool[]> {
  const upstreamTools = await toolProxy.getTools();

  const wrappedTools = upstreamTools.map(tool => ({
    ...tool,
    _meta: {
      ...tool._meta,
      ui: {
        resourceUri: `ui://${tool.name}`
      }
    }
  }));

  const wrapperTools = [
    { name: "_ui_refine", ... },
    { name: "_ui_list", ... },
    { name: "_ui_inspect", ... },
    { name: "_ui_regenerate", ... }
  ];

  return [...wrappedTools, ...wrapperTools];
}
```

### 5.2 Tool Proxy

**Responsibility**: Forward tool calls to the underlying server.

**Key Operations**:

| Operation | Description |
|-----------|-------------|
| `connect()` | Establish connection to upstream server |
| `getTools()` | Retrieve tool definitions |
| `callTool(name, args)` | Forward call, return result |
| `onSchemaChange(callback)` | Notify when tools change (for cache invalidation) |

**Implementation Notes**:

- Maintains a persistent connection to the upstream server
- Supports both stdio (spawn subprocess) and SSE (HTTP connection) transports
- Caches tool definitions locally for fast lookup
- Detects schema changes by comparing tool list on periodic refresh

```typescript
interface ToolProxy {
  connect(): Promise<void>;
  getTools(): Promise<ToolDefinition[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  disconnect(): Promise<void>;
  onToolsChanged(callback: (tools: ToolDefinition[]) => void): void;
}
```

### 5.3 UI Generator

**Responsibility**: Generate HTML UIs using an LLM.

**Key Operations**:

| Operation | Description |
|-----------|-------------|
| `generate(context)` | Generate UI HTML from tool metadata |
| `generateWithRefinement(context, history)` | Generate with accumulated feedback |
| `classifyTool(tool)` | Determine if tool warrants rich or minimal UI |

**Implementation Notes**:

- Abstracts LLM provider (Anthropic, OpenAI, Ollama)
- Manages prompt templates as external files
- Validates generated HTML before returning
- Implements retry logic with exponential backoff

```typescript
interface UIGenerator {
  generate(context: UIGenerationContext): Promise<GenerationResult>;
  setProvider(provider: LLMProvider): void;
  loadPromptTemplates(directory: string): void;
}

interface GenerationResult {
  html: string;
  uiType: "rich" | "minimal";
  generationDurationMs: number;
  tokensUsed: number;
}
```

### 5.4 Cache Manager

**Responsibility**: Store and retrieve generated UIs.

**Key Operations**:

| Operation | Description |
|-----------|-------------|
| `get(key)` | Retrieve cached entry |
| `set(key, entry)` | Store entry |
| `invalidate(toolName)` | Remove all entries for a tool |
| `invalidateAll()` | Clear entire cache |
| `persist()` | Write cache to filesystem |
| `restore()` | Load cache from filesystem |

**Implementation Notes**:

- LRU eviction when max entries exceeded
- Filesystem persistence is optional, enabled via config
- Cache entries include generation metadata for debugging

```typescript
interface CacheManager {
  get(key: string): CacheEntry | undefined;
  set(key: string, entry: CacheEntry): void;
  has(key: string): boolean;
  invalidateByTool(toolName: string): void;
  clear(): void;
  persist(path: string): Promise<void>;
  restore(path: string): Promise<void>;
  stats(): CacheStats;
}

interface CacheStats {
  entries: number;
  hits: number;
  misses: number;
  hitRate: number;
}
```

### 5.5 Refinement Manager

**Responsibility**: Track refinement history per tool.

**Key Operations**:

| Operation | Description |
|-----------|-------------|
| `addRefinement(toolName, feedback)` | Append feedback to history |
| `getHistory(toolName)` | Get all refinements for a tool |
| `clearHistory(toolName)` | Reset refinements for a tool |
| `computeHistoryHash(toolName)` | Hash for cache key |

**Implementation Notes**:

- Refinements are session-scoped (lost on wrapper restart)
- Future versions may persist to filesystem
- History is ordered; all refinements are cumulative

```typescript
interface RefinementManager {
  add(toolName: string, feedback: string): void;
  get(toolName: string): RefinementEntry[];
  clear(toolName: string): void;
  hash(toolName: string): string;
}
```

---

## 6. Data Models and Schemas

### 6.1 Core Types

```typescript
// Tool definition as received from upstream server
interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JSONSchema;
}

// Extended tool definition exposed to host
interface WrappedToolDefinition extends ToolDefinition {
  _meta: {
    ui: {
      resourceUri: string;  // e.g., "ui://tool-name"
    };
  };
}

// Internal registry entry
interface ToolRegistryEntry {
  original: ToolDefinition;
  schemaHash: string;
  uiResourceUri: string;
  uiType: "rich" | "minimal" | "undetermined";
  refinementHistory: RefinementEntry[];
}

// Refinement feedback
interface RefinementEntry {
  timestamp: Date;
  feedback: string;
  generationHashBefore: string;
}

// Cache entry
interface CacheEntry {
  key: string;
  html: string;
  generatedAt: Date;
  generationDurationMs: number;
  llmModel: string;
  promptVersion: string;
  context: UIGenerationContext;
}

// Context passed to LLM for generation
interface UIGenerationContext {
  tool: {
    name: string;
    description: string;
    inputSchema: JSONSchema;
    outputSchema?: JSONSchema;
  };
  refinements: string[];
  hints: {
    theme: "light" | "dark" | "system";
    uiType?: "chart" | "table" | "form" | "card" | "list";
  };
  examples?: Array<{
    input: unknown;
    output: unknown;
  }>;
}
```

### 6.2 Configuration Schema

```typescript
interface WrapperConfig {
  // Upstream server connection
  upstream: StdioUpstreamConfig | SSEUpstreamConfig;

  // LLM provider configuration
  llm: LLMConfig;

  // Cache settings
  cache: CacheConfig;

  // Generation defaults
  generation: GenerationConfig;

  // Logging
  logging: LoggingConfig;
}

interface StdioUpstreamConfig {
  transport: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

interface SSEUpstreamConfig {
  transport: "sse";
  url: string;
  headers?: Record<string, string>;
}

interface LLMConfig {
  provider: "anthropic" | "openai" | "ollama";
  model: string;
  apiKey?: string;        // Falls back to env var
  baseUrl?: string;       // For custom endpoints
  maxTokens?: number;     // Default: 4096
  temperature?: number;   // Default: 0.2
}

interface CacheConfig {
  type: "memory" | "filesystem";
  directory?: string;     // For filesystem cache
  maxEntries?: number;    // Default: 100
  persistOnShutdown?: boolean;
}

interface GenerationConfig {
  defaultTheme: "light" | "dark" | "system";
  promptsDirectory?: string;
  maxRetries?: number;    // Default: 2
  retryDelayMs?: number;  // Default: 1000
}

interface LoggingConfig {
  level: "debug" | "info" | "warn" | "error";
  format: "json" | "text";
  destination: "stdout" | "file";
  file?: string;
}
```

### 6.3 JSON Schema for Config File

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["upstream", "llm"],
  "properties": {
    "upstream": {
      "oneOf": [
        {
          "type": "object",
          "required": ["transport", "command"],
          "properties": {
            "transport": { "const": "stdio" },
            "command": { "type": "string" },
            "args": { "type": "array", "items": { "type": "string" } },
            "env": { "type": "object", "additionalProperties": { "type": "string" } },
            "cwd": { "type": "string" }
          }
        },
        {
          "type": "object",
          "required": ["transport", "url"],
          "properties": {
            "transport": { "const": "sse" },
            "url": { "type": "string", "format": "uri" },
            "headers": { "type": "object", "additionalProperties": { "type": "string" } }
          }
        }
      ]
    },
    "llm": {
      "type": "object",
      "required": ["provider", "model"],
      "properties": {
        "provider": { "enum": ["anthropic", "openai", "ollama"] },
        "model": { "type": "string" },
        "apiKey": { "type": "string" },
        "baseUrl": { "type": "string", "format": "uri" },
        "maxTokens": { "type": "integer", "minimum": 1 },
        "temperature": { "type": "number", "minimum": 0, "maximum": 2 }
      }
    },
    "cache": {
      "type": "object",
      "properties": {
        "type": { "enum": ["memory", "filesystem"], "default": "memory" },
        "directory": { "type": "string" },
        "maxEntries": { "type": "integer", "minimum": 1, "default": 100 },
        "persistOnShutdown": { "type": "boolean", "default": false }
      }
    },
    "generation": {
      "type": "object",
      "properties": {
        "defaultTheme": { "enum": ["light", "dark", "system"], "default": "light" },
        "promptsDirectory": { "type": "string" },
        "maxRetries": { "type": "integer", "minimum": 0, "default": 2 },
        "retryDelayMs": { "type": "integer", "minimum": 0, "default": 1000 }
      }
    },
    "logging": {
      "type": "object",
      "properties": {
        "level": { "enum": ["debug", "info", "warn", "error"], "default": "info" },
        "format": { "enum": ["json", "text"], "default": "text" },
        "destination": { "enum": ["stdout", "file"], "default": "stdout" },
        "file": { "type": "string" }
      }
    }
  }
}
```

---

## 7. API Interfaces

### 7.1 MCP Protocol Extensions

The wrapper exposes standard MCP methods plus wrapper-specific tools.

#### 7.1.1 Standard MCP Methods

```typescript
// initialize
{
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "...", version: "..." }
  }
}
// Response includes wrapper info

// tools/list
{
  method: "tools/list"
}
// Response: array of tools, each with _meta.ui.resourceUri

// tools/call
{
  method: "tools/call",
  params: {
    name: "tool_name",
    arguments: { ... }
  }
}
// Response: forwarded from upstream, or handled locally for _ui_* tools

// resources/list
{
  method: "resources/list"
}
// Response: array of ui:// resources

// resources/read
{
  method: "resources/read",
  params: {
    uri: "ui://tool-name"
  }
}
// Response: generated HTML with mimeType "text/html;profile=mcp-app"
```

#### 7.1.2 Wrapper Introspection Tools

**`_ui_refine`** - Refine a tool's UI with natural language feedback

```typescript
{
  name: "_ui_refine",
  description: "Refine the generated UI for a tool based on natural language feedback. The feedback will be incorporated into the next UI generation.",
  inputSchema: {
    type: "object",
    properties: {
      toolName: {
        type: "string",
        description: "Name of the tool whose UI to refine"
      },
      feedback: {
        type: "string",
        description: "Natural language description of desired changes (e.g., 'use a dark theme', 'make the table sortable')"
      }
    },
    required: ["toolName", "feedback"]
  }
}

// Response
{
  content: [{
    type: "text",
    text: "UI refinement queued for tool 'get_forecast'. The updated UI will be available on next resource request."
  }]
}
```

**`_ui_list`** - List all tools and their UI status

```typescript
{
  name: "_ui_list",
  description: "List all wrapped tools and their UI generation status",
  inputSchema: {
    type: "object",
    properties: {}
  }
}

// Response
{
  content: [{
    type: "text",
    text: JSON.stringify({
      tools: [
        {
          name: "get_weather",
          uiType: "rich",
          cached: true,
          refinements: 2
        },
        {
          name: "set_units",
          uiType: "minimal",
          cached: true,
          refinements: 0
        }
      ]
    }, null, 2)
  }]
}
```

**`_ui_inspect`** - Get detailed UI generation info for a tool

```typescript
{
  name: "_ui_inspect",
  description: "Get detailed information about the UI generation for a specific tool",
  inputSchema: {
    type: "object",
    properties: {
      toolName: {
        type: "string",
        description: "Name of the tool to inspect"
      }
    },
    required: ["toolName"]
  }
}

// Response
{
  content: [{
    type: "text",
    text: JSON.stringify({
      tool: "get_weather",
      uiType: "rich",
      cached: true,
      cacheKey: "get_weather:a1b2c3:d4e5f6",
      generatedAt: "2026-01-28T10:30:00Z",
      generationDurationMs: 3420,
      llmModel: "claude-sonnet-4-20250514",
      promptVersion: "1.0",
      refinementHistory: [
        "use dark theme",
        "add wind speed to the display"
      ],
      inputSchema: { ... }
    }, null, 2)
  }]
}
```

**`_ui_regenerate`** - Force UI regeneration (bypass cache)

```typescript
{
  name: "_ui_regenerate",
  description: "Force regeneration of the UI for a tool, ignoring the cache",
  inputSchema: {
    type: "object",
    properties: {
      toolName: {
        type: "string",
        description: "Name of the tool to regenerate UI for"
      },
      clearRefinements: {
        type: "boolean",
        description: "If true, also clear refinement history",
        default: false
      }
    },
    required: ["toolName"]
  }
}

// Response
{
  content: [{
    type: "text",
    text: "UI regenerated for tool 'get_weather'. Generation took 2850ms."
  }]
}
```

### 7.2 Internal Interfaces

#### 7.2.1 LLM Provider Interface

```typescript
interface LLMProvider {
  name: string;

  generate(request: LLMRequest): Promise<LLMResponse>;

  // For streaming support (future)
  generateStream?(request: LLMRequest): AsyncIterable<string>;
}

interface LLMRequest {
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  temperature: number;
  stopSequences?: string[];
}

interface LLMResponse {
  content: string;
  tokensUsed: {
    input: number;
    output: number;
  };
  model: string;
  finishReason: "stop" | "max_tokens" | "error";
}
```

#### 7.2.2 Transport Interface

```typescript
interface UpstreamTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  send(method: string, params?: unknown): Promise<unknown>;

  onNotification(callback: (method: string, params: unknown) => void): void;
}
```

---

## 8. UI Generation Pipeline

### 8.1 Pipeline Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                      UI Generation Pipeline                          │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│  1. Context Assembly                                                 │
│     • Extract tool name, description, inputSchema                   │
│     • Gather refinement history                                     │
│     • Determine hints (theme, UI type suggestion)                   │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│  2. UI Type Classification                                          │
│     • LLM classifies tool as "rich" or "minimal"                    │
│     • Minimal = simple form + JSON output                           │
│     • Rich = custom visualization (chart, table, cards, etc.)       │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    ▼                           ▼
           ┌───────────────┐           ┌───────────────┐
           │   Minimal UI  │           │    Rich UI    │
           │   Template    │           │   Generation  │
           └───────┬───────┘           └───────┬───────┘
                   │                           │
                   │                           ▼
                   │               ┌───────────────────┐
                   │               │  3. Prompt Build  │
                   │               │     • System      │
                   │               │     • User        │
                   │               │     • Examples    │
                   │               └─────────┬─────────┘
                   │                         │
                   │                         ▼
                   │               ┌───────────────────┐
                   │               │  4. LLM Call      │
                   │               │     • Retry on    │
                   │               │       failure     │
                   │               └─────────┬─────────┘
                   │                         │
                   └──────────┬──────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  5. HTML Validation                                                  │
│     • Parse HTML (check well-formedness)                            │
│     • Verify App API import present                                 │
│     • Verify ontoolresult handler present                           │
│     • Check for forbidden patterns (external scripts, etc.)         │
└─────────────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
            [Valid HTML]        [Invalid HTML]
                    │                   │
                    │                   ▼
                    │         ┌───────────────────┐
                    │         │  6. Repair        │
                    │         │     • Fix prompt  │
                    │         │     • Inject App  │
                    │         │       API if      │
                    │         │       missing     │
                    │         └─────────┬─────────┘
                    │                   │
                    │         ┌─────────┴─────────┐
                    │         ▼                   ▼
                    │    [Repaired]          [Unrepairable]
                    │         │                   │
                    │         │                   ▼
                    │         │         ┌───────────────────┐
                    │         │         │  Use Minimal UI   │
                    │         │         │  with error note  │
                    │         │         └─────────┬─────────┘
                    │         │                   │
                    └─────────┴───────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  7. Cache Storage                                                    │
│     • Compute cache key                                             │
│     • Store HTML + metadata                                         │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                        [Return HTML]
```

### 8.2 Prompt Templates

#### 8.2.1 System Prompt

```
You are a UI generator for MCP Apps. Your task is to generate a complete, self-contained HTML file that provides an interactive interface for an MCP tool.

REQUIREMENTS:
1. Output a single HTML file with inline <style> and <script type="module">
2. Use the @modelcontextprotocol/ext-apps package for host communication
3. Import as: import { App } from "@modelcontextprotocol/ext-apps";
4. Initialize the App and call app.connect() before any operations
5. Implement app.ontoolresult to receive and render tool results
6. Provide an input form to invoke the tool with new parameters
7. Use app.callServerTool({ name, arguments }) to call tools from the UI
8. Include error handling with try/catch and display errors to users
9. Style should be clean, functional, and use system fonts
10. The UI must be fully functional without any TODO comments or placeholders

ERROR HANDLING PATTERN (include this in every UI):
window.onerror = (msg) => {
  document.getElementById('error').textContent = msg;
  document.getElementById('error').style.display = 'block';
};

OUTPUT ONLY THE HTML FILE. No markdown, no explanation, no code fences.
```

#### 8.2.2 Generation Prompt Template

```
Generate a UI for this MCP tool:

TOOL NAME: {{tool.name}}
DESCRIPTION: {{tool.description}}

INPUT SCHEMA:
{{JSON.stringify(tool.inputSchema, null, 2)}}

{{#if tool.outputSchema}}
OUTPUT SCHEMA:
{{JSON.stringify(tool.outputSchema, null, 2)}}
{{/if}}

{{#if refinements.length}}
USER REFINEMENT REQUESTS (apply ALL of these to the UI):
{{#each refinements}}
- {{this}}
{{/each}}
{{/if}}

REQUIREMENTS:
- Theme: {{hints.theme}}
- Create appropriate form controls for each input property
- Handle required vs optional fields appropriately
- Render the tool result in a meaningful way based on the output structure
- Add loading state while tool is executing
- Show errors clearly with option to retry
```

#### 8.2.3 Classification Prompt

```
Analyze this MCP tool and determine the appropriate UI type:

TOOL NAME: {{tool.name}}
DESCRIPTION: {{tool.description}}
INPUT SCHEMA: {{JSON.stringify(tool.inputSchema)}}

Respond with exactly one word: "rich" or "minimal"

Guidelines:
- "rich": Tools that return structured data suitable for visualization (lists, charts, tables, maps, timelines)
- "minimal": Tools that perform actions with simple success/failure, set preferences, or return unstructured text

Examples:
- get_weather -> rich (can visualize temperature, conditions)
- list_files -> rich (can show as table/tree)
- delete_item -> minimal (action confirmation)
- set_preference -> minimal (simple toggle/success)
- search_database -> rich (results table)
- send_notification -> minimal (action confirmation)
```

### 8.3 Minimal UI Template

This template is used for tools classified as "minimal" or as a fallback:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{tool.name}}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      padding: 20px;
      max-width: 600px;
      margin: 0 auto;
      line-height: 1.5;
    }
    h1 { font-size: 1.25rem; margin: 0 0 4px 0; }
    .description { color: #666; font-size: 0.875rem; margin-bottom: 20px; }
    .form-group { margin-bottom: 16px; }
    label {
      display: block;
      font-weight: 500;
      font-size: 0.875rem;
      margin-bottom: 4px;
    }
    .required::after { content: " *"; color: #c00; }
    input, textarea, select {
      width: 100%;
      padding: 8px 12px;
      border: 1px solid #ccc;
      border-radius: 6px;
      font-size: 0.875rem;
    }
    input:focus, textarea:focus, select:focus {
      outline: none;
      border-color: #007bff;
      box-shadow: 0 0 0 2px rgba(0,123,255,0.15);
    }
    button {
      background: #007bff;
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 6px;
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;
    }
    button:hover { background: #0056b3; }
    button:disabled { background: #ccc; cursor: not-allowed; }
    .result {
      margin-top: 20px;
      padding: 16px;
      background: #f8f9fa;
      border-radius: 6px;
      border: 1px solid #e9ecef;
    }
    .result pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 0.8125rem;
    }
    .error {
      display: none;
      margin-top: 16px;
      padding: 12px 16px;
      background: #fee;
      border: 1px solid #fcc;
      border-radius: 6px;
      color: #c00;
      font-size: 0.875rem;
    }
    .loading {
      display: none;
      margin-top: 16px;
      color: #666;
      font-size: 0.875rem;
    }
    .loading::after {
      content: '';
      animation: dots 1.5s steps(3) infinite;
    }
    @keyframes dots {
      0% { content: ''; }
      33% { content: '.'; }
      66% { content: '..'; }
      100% { content: '...'; }
    }
  </style>
</head>
<body>
  <h1>{{tool.name}}</h1>
  <p class="description">{{tool.description}}</p>

  <form id="tool-form">
    {{#each inputSchema.properties}}
    <div class="form-group">
      <label for="{{@key}}" {{#if (includes ../inputSchema.required @key)}}class="required"{{/if}}>
        {{@key}}
      </label>
      {{#if (eq this.type "boolean")}}
      <select id="{{@key}}" name="{{@key}}">
        <option value="">-- Select --</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
      {{else if this.enum}}
      <select id="{{@key}}" name="{{@key}}" {{#if (includes ../inputSchema.required @key)}}required{{/if}}>
        <option value="">-- Select --</option>
        {{#each this.enum}}
        <option value="{{this}}">{{this}}</option>
        {{/each}}
      </select>
      {{else if (eq this.type "integer")}}
      <input type="number" id="{{@key}}" name="{{@key}}" step="1"
        {{#if (includes ../inputSchema.required @key)}}required{{/if}}>
      {{else if (eq this.type "number")}}
      <input type="number" id="{{@key}}" name="{{@key}}" step="any"
        {{#if (includes ../inputSchema.required @key)}}required{{/if}}>
      {{else}}
      <input type="text" id="{{@key}}" name="{{@key}}"
        placeholder="{{this.description}}"
        {{#if (includes ../inputSchema.required @key)}}required{{/if}}>
      {{/if}}
    </div>
    {{/each}}

    <button type="submit" id="submit-btn">Execute</button>
  </form>

  <div class="loading" id="loading">Executing</div>
  <div class="error" id="error"></div>
  <div class="result" id="result" style="display: none;">
    <strong>Result:</strong>
    <pre id="result-content"></pre>
  </div>

  <script type="module">
    import { App } from "@modelcontextprotocol/ext-apps";

    const app = new App({ name: "{{tool.name}}-ui", version: "1.0.0" });

    window.onerror = (msg) => {
      document.getElementById('error').textContent = msg;
      document.getElementById('error').style.display = 'block';
      document.getElementById('loading').style.display = 'none';
    };

    await app.connect();

    app.ontoolresult = (result) => {
      document.getElementById('loading').style.display = 'none';
      document.getElementById('error').style.display = 'none';
      document.getElementById('result').style.display = 'block';

      const text = result.content?.find(c => c.type === "text")?.text;
      if (text) {
        try {
          const parsed = JSON.parse(text);
          document.getElementById('result-content').textContent = JSON.stringify(parsed, null, 2);
        } catch {
          document.getElementById('result-content').textContent = text;
        }
      } else {
        document.getElementById('result-content').textContent = JSON.stringify(result.content, null, 2);
      }

      document.getElementById('submit-btn').disabled = false;
    };

    document.getElementById('tool-form').addEventListener('submit', async (e) => {
      e.preventDefault();

      const formData = new FormData(e.target);
      const args = {};
      for (const [key, value] of formData.entries()) {
        if (value !== '') {
          // Type coercion based on schema
          args[key] = value;
        }
      }

      document.getElementById('loading').style.display = 'block';
      document.getElementById('error').style.display = 'none';
      document.getElementById('result').style.display = 'none';
      document.getElementById('submit-btn').disabled = true;

      try {
        await app.callServerTool({ name: "{{tool.name}}", arguments: args });
      } catch (err) {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('error').textContent = err.message || 'Tool execution failed';
        document.getElementById('error').style.display = 'block';
        document.getElementById('submit-btn').disabled = false;
      }
    });
  </script>
</body>
</html>
```

### 8.4 HTML Validation Rules

The validator checks generated HTML for:

| Check | Required | Action on Failure |
|-------|----------|-------------------|
| Well-formed HTML | Yes | Repair or fallback |
| Has `<script type="module">` | Yes | Inject boilerplate |
| Imports `@modelcontextprotocol/ext-apps` | Yes | Inject import |
| Calls `app.connect()` | Yes | Inject connection |
| Has `ontoolresult` handler | Yes | Inject minimal handler |
| No external scripts (except ext-apps CDN) | Yes | Remove or fallback |
| No `eval()`, `Function()`, `document.write()` | Yes | Fallback |
| No `parent.`, `top.`, `opener.` access | Yes | Fallback |

---

## 9. Error Handling Strategy

### 9.1 Error Categories

| Category | Examples | Strategy |
|----------|----------|----------|
| **Connection Errors** | Upstream server unreachable, transport failure | Return MCP error, retry with backoff |
| **Generation Errors** | LLM timeout, rate limit, invalid response | Retry once, then serve minimal UI |
| **Validation Errors** | Malformed HTML, missing App API | Attempt repair, then serve minimal UI |
| **Runtime Errors** | JS error in generated UI | Caught by error boundary, show raw data |
| **Tool Errors** | Upstream tool returns error | Forward to UI, display with context |

### 9.2 Retry Policy

```typescript
const RETRY_CONFIG = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  retryableErrors: [
    'TIMEOUT',
    'RATE_LIMIT',
    'NETWORK_ERROR',
    'SERVER_ERROR'
  ]
};

async function withRetry<T>(
  operation: () => Promise<T>,
  config = RETRY_CONFIG
): Promise<T> {
  let lastError: Error;
  let delay = config.baseDelayMs;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (!config.retryableErrors.includes(error.code)) {
        throw error;
      }

      if (attempt < config.maxAttempts) {
        await sleep(delay);
        delay = Math.min(delay * config.backoffMultiplier, config.maxDelayMs);
      }
    }
  }

  throw lastError;
}
```

### 9.3 Graceful Degradation

Every error path leads to a functional (if minimal) UI:

```
┌─────────────────────────────────────────────────────────────────┐
│                     Error Degradation Levels                     │
└─────────────────────────────────────────────────────────────────┘

Level 0: Full Generated UI
   │ LLM generates rich, custom visualization
   │
   ▼ (generation timeout/error after retries)
Level 1: Repaired Generated UI
   │ Missing App API injected, basic fixes applied
   │
   ▼ (HTML validation fails completely)
Level 2: Minimal Template UI
   │ Standard form + JSON output display
   │
   ▼ (template rendering fails)
Level 3: Emergency Fallback
   │ Plain HTML showing tool name, error message, raw data
```

### 9.4 Error Response Format

All wrapper-handled errors return standard MCP error format:

```typescript
{
  error: {
    code: -32000,  // Application-specific error
    message: "UI generation failed",
    data: {
      toolName: "get_weather",
      errorType: "GENERATION_TIMEOUT",
      fallbackUsed: "minimal_template",
      retryable: false
    }
  }
}
```

---

## 10. Security Considerations

### 10.1 Threat Model

| Threat | Attack Vector | Mitigation |
|--------|---------------|------------|
| **Prompt Injection** | Malicious tool description injects LLM instructions | Escape/sanitize tool metadata in prompts |
| **XSS in Generated UI** | LLM generates malicious JS | Sandbox + validation + CSP |
| **Data Exfiltration** | Generated UI sends data to external server | Block external network in sandbox |
| **Credential Leakage** | LLM API key exposed to UI or logs | Keys in env vars, never in generated code |
| **Parent Frame Access** | Generated JS tries to escape sandbox | MCP Apps sandbox enforces isolation |
| **Resource Exhaustion** | Unbounded generation requests | Rate limiting, cache, LRU eviction |

### 10.2 Input Sanitization

Tool metadata from the upstream server is untrusted:

```typescript
function sanitizeForPrompt(text: string): string {
  // Remove potential prompt injection markers
  return text
    .replace(/```/g, "'''")           // Prevent code fence escape
    .replace(/#{3,}/g, '')            // Remove heading injection
    .replace(/<\/?[a-z][^>]*>/gi, '') // Strip HTML tags
    .replace(/\{%.*?%\}/g, '')        // Remove template syntax
    .substring(0, 10000);             // Limit length
}
```

### 10.3 Generated HTML Validation

```typescript
interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  sanitized?: string;
}

function validateGeneratedHTML(html: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check for forbidden patterns
  const forbiddenPatterns = [
    { pattern: /eval\s*\(/g, message: "eval() is forbidden" },
    { pattern: /new\s+Function\s*\(/g, message: "Function constructor is forbidden" },
    { pattern: /document\.write/g, message: "document.write is forbidden" },
    { pattern: /parent\./g, message: "parent frame access is forbidden" },
    { pattern: /top\./g, message: "top frame access is forbidden" },
    { pattern: /opener\./g, message: "opener access is forbidden" },
    { pattern: /<script[^>]+src=/gi, message: "External scripts forbidden" },
    { pattern: /on\w+\s*=/gi, message: "Inline event handlers discouraged" }
  ];

  for (const { pattern, message } of forbiddenPatterns) {
    if (pattern.test(html)) {
      errors.push(message);
    }
  }

  // Check for required patterns
  if (!html.includes('@modelcontextprotocol/ext-apps')) {
    errors.push("Missing App API import");
  }
  if (!html.includes('ontoolresult')) {
    errors.push("Missing ontoolresult handler");
  }
  if (!html.includes('app.connect')) {
    warnings.push("Missing app.connect() call");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}
```

### 10.4 Credential Management

```
┌─────────────────────────────────────────────────────────────────┐
│                    Credential Flow                               │
└─────────────────────────────────────────────────────────────────┘

Environment Variables (secure):
  ANTHROPIC_API_KEY, OPENAI_API_KEY, OLLAMA_API_KEY
         │
         ▼
    ┌─────────┐
    │ Wrapper │ ◄── Config file MAY contain apiKey (not recommended)
    └────┬────┘
         │
         ├───────────────────────────────────────────┐
         │                                           │
         ▼                                           ▼
    ┌─────────┐                               ┌─────────────┐
    │ LLM API │                               │  Generated  │
    │         │                               │    HTML     │
    └─────────┘                               └─────────────┘
                                                     │
                                              No credentials
                                              ever included
```

---

## 11. Observability

### 11.1 Structured Logging

All log entries follow a consistent JSON structure:

```typescript
interface LogEntry {
  timestamp: string;       // ISO 8601
  level: "debug" | "info" | "warn" | "error";
  component: string;       // e.g., "tool_proxy", "ui_generator", "cache"
  event: string;           // e.g., "generation_started", "cache_hit"
  duration_ms?: number;
  tool_name?: string;
  cache_key?: string;
  error?: {
    code: string;
    message: string;
    stack?: string;
  };
  metadata?: Record<string, unknown>;
}
```

Example log output:

```json
{"timestamp":"2026-01-28T10:30:00.000Z","level":"info","component":"wrapper","event":"startup","metadata":{"upstream":"stdio:node weather-server.js"}}
{"timestamp":"2026-01-28T10:30:00.500Z","level":"info","component":"tool_proxy","event":"tools_discovered","metadata":{"count":3,"tools":["get_weather","get_forecast","set_units"]}}
{"timestamp":"2026-01-28T10:30:05.000Z","level":"debug","component":"cache","event":"miss","tool_name":"get_forecast","cache_key":"get_forecast:a1b2c3:000000"}
{"timestamp":"2026-01-28T10:30:05.001Z","level":"info","component":"ui_generator","event":"generation_started","tool_name":"get_forecast","metadata":{"refinements":0}}
{"timestamp":"2026-01-28T10:30:08.420Z","level":"info","component":"ui_generator","event":"generation_completed","tool_name":"get_forecast","duration_ms":3420,"metadata":{"tokens":1250,"ui_type":"rich"}}
{"timestamp":"2026-01-28T10:30:08.421Z","level":"debug","component":"cache","event":"set","tool_name":"get_forecast","cache_key":"get_forecast:a1b2c3:000000"}
```

### 11.2 Metrics (Future)

For V2, expose Prometheus-compatible metrics:

```
# HELP mcp_gen_ui_generation_duration_seconds UI generation latency
# TYPE mcp_gen_ui_generation_duration_seconds histogram
mcp_gen_ui_generation_duration_seconds_bucket{tool="get_forecast",le="1"} 0
mcp_gen_ui_generation_duration_seconds_bucket{tool="get_forecast",le="3"} 5
mcp_gen_ui_generation_duration_seconds_bucket{tool="get_forecast",le="5"} 8
mcp_gen_ui_generation_duration_seconds_bucket{tool="get_forecast",le="10"} 10

# HELP mcp_gen_ui_cache_hits_total Cache hit count
# TYPE mcp_gen_ui_cache_hits_total counter
mcp_gen_ui_cache_hits_total{tool="get_forecast"} 47

# HELP mcp_gen_ui_cache_misses_total Cache miss count
# TYPE mcp_gen_ui_cache_misses_total counter
mcp_gen_ui_cache_misses_total{tool="get_forecast"} 3
```

### 11.3 Debug Mode

When `--debug` flag is set:

1. Verbose logging (all debug events)
2. Generated prompts logged before LLM call
3. Raw LLM responses logged
4. Generated HTML saved to disk for inspection
5. Cache disabled (every request regenerates)

---

## 12. Concrete Examples

### 12.1 Example: Weather MCP Server

**Upstream Server Tools:**

```json
[
  {
    "name": "get_current_weather",
    "description": "Get current weather conditions for a location",
    "inputSchema": {
      "type": "object",
      "properties": {
        "location": {
          "type": "string",
          "description": "City name or coordinates"
        }
      },
      "required": ["location"]
    }
  },
  {
    "name": "get_forecast",
    "description": "Get weather forecast for upcoming days",
    "inputSchema": {
      "type": "object",
      "properties": {
        "location": { "type": "string" },
        "days": { "type": "integer", "minimum": 1, "maximum": 14 }
      },
      "required": ["location"]
    }
  }
]
```

**Wrapper Tool Exposure:**

```json
[
  {
    "name": "get_current_weather",
    "description": "Get current weather conditions for a location",
    "inputSchema": { ... },
    "_meta": {
      "ui": {
        "resourceUri": "ui://get_current_weather"
      }
    }
  },
  ...
]
```

**Generated UI for `get_forecast` (Rich):**

The LLM generates something like:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Weather Forecast</title>
  <style>
    body { font-family: system-ui; padding: 20px; max-width: 800px; margin: 0 auto; }
    .forecast-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 12px; margin-top: 20px; }
    .day-card { padding: 16px; background: #f0f4f8; border-radius: 8px; text-align: center; }
    .day-card .date { font-weight: 600; color: #333; }
    .day-card .temps { margin: 8px 0; }
    .day-card .high { color: #e53e3e; }
    .day-card .low { color: #3182ce; }
    .day-card .conditions { font-size: 0.875rem; color: #666; }
    /* ... more styles ... */
  </style>
</head>
<body>
  <h1>Weather Forecast</h1>

  <form id="forecast-form">
    <div class="form-row">
      <label for="location">Location</label>
      <input type="text" id="location" name="location" placeholder="e.g., San Francisco" required>
    </div>
    <div class="form-row">
      <label for="days">Days (1-14)</label>
      <input type="range" id="days" name="days" min="1" max="14" value="7">
      <span id="days-value">7</span>
    </div>
    <button type="submit">Get Forecast</button>
  </form>

  <div id="loading" style="display: none;">Loading forecast...</div>
  <div id="error" style="display: none;"></div>

  <div id="forecast-grid" class="forecast-grid"></div>

  <script type="module">
    import { App } from "@modelcontextprotocol/ext-apps";

    const app = new App({ name: "weather-forecast-ui", version: "1.0.0" });
    await app.connect();

    const daysSlider = document.getElementById('days');
    const daysValue = document.getElementById('days-value');
    daysSlider.addEventListener('input', () => daysValue.textContent = daysSlider.value);

    app.ontoolresult = (result) => {
      document.getElementById('loading').style.display = 'none';

      const text = result.content?.find(c => c.type === "text")?.text;
      if (!text) return;

      try {
        const forecast = JSON.parse(text);
        const grid = document.getElementById('forecast-grid');
        grid.innerHTML = forecast.map(day => `
          <div class="day-card">
            <div class="date">${day.date}</div>
            <div class="temps">
              <span class="high">${day.high}°</span> /
              <span class="low">${day.low}°</span>
            </div>
            <div class="conditions">${day.conditions}</div>
          </div>
        `).join('');
      } catch (e) {
        document.getElementById('error').textContent = 'Failed to parse forecast';
        document.getElementById('error').style.display = 'block';
      }
    };

    document.getElementById('forecast-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      document.getElementById('loading').style.display = 'block';
      document.getElementById('error').style.display = 'none';
      document.getElementById('forecast-grid').innerHTML = '';

      const formData = new FormData(e.target);
      await app.callServerTool({
        name: "get_forecast",
        arguments: {
          location: formData.get('location'),
          days: parseInt(formData.get('days'))
        }
      });
    });
  </script>
</body>
</html>
```

### 12.2 Example: Refinement Flow

**Initial State:**
- User has interacted with `get_forecast` UI
- Current UI shows forecast as cards

**User Request:**
> "Show the forecast as a line chart with temperature on Y axis and date on X axis"

**Host Action:**
Invokes `_ui_refine` tool:
```json
{
  "name": "_ui_refine",
  "arguments": {
    "toolName": "get_forecast",
    "feedback": "Show the forecast as a line chart with temperature on Y axis and date on X axis"
  }
}
```

**Wrapper Actions:**

1. Append feedback to refinement history:
   ```typescript
   refinements["get_forecast"].push({
     timestamp: new Date(),
     feedback: "Show the forecast as a line chart with temperature on Y axis and date on X axis",
     generationHashBefore: "abc123"
   });
   ```

2. Invalidate cache entry for `get_forecast`

3. On next `ui://get_forecast` request, regenerate with prompt including:
   ```
   USER REFINEMENT REQUESTS (apply ALL of these to the UI):
   - Show the forecast as a line chart with temperature on Y axis and date on X axis
   ```

4. LLM generates new UI with chart visualization (using Canvas or SVG)

5. Cache new generation

**Result:**
User sees updated UI with line chart instead of cards.

### 12.3 Example: Fallback Scenario

**Situation:**
- LLM returns HTML that fails validation (missing App API import)
- Repair attempt fails (HTML is severely malformed)

**Fallback Chain:**

1. **First Attempt**: Generate rich UI
   - Result: HTML missing `@modelcontextprotocol/ext-apps` import

2. **Repair Attempt**: Inject App API boilerplate
   - Result: Injection point unclear due to malformed structure

3. **Fallback**: Use minimal template
   - Result: Functional form + JSON output display

4. **Log Warning**:
   ```json
   {
     "level": "warn",
     "component": "ui_generator",
     "event": "fallback_used",
     "tool_name": "get_weather",
     "metadata": {
       "reason": "validation_failed",
       "errors": ["Missing App API import", "Malformed HTML structure"]
     }
   }
   ```

---

## 13. Implementation Task Breakdown

### Phase 1: Foundation (Week 1-2)

#### Task 1.1: Project Setup
- Initialize TypeScript project with proper structure
- Set up build tooling (esbuild or tsup for bundling)
- Configure ESLint, Prettier
- Add testing framework (Vitest)
- Create package.json with correct dependencies

**Files:**
- `package.json`
- `tsconfig.json`
- `vitest.config.ts`
- `.eslintrc.js`

#### Task 1.2: Configuration System
- Implement config file loading and validation
- Support environment variable overrides
- Create JSON Schema for config validation
- Add CLI argument parsing (commander.js)

**Files:**
- `src/config/schema.ts`
- `src/config/loader.ts`
- `src/cli.ts`

**Tests:**
- Config loading with various formats
- Environment variable precedence
- Invalid config rejection

#### Task 1.3: Logging System
- Implement structured logger
- Support multiple output formats (JSON, text)
- Add log levels and filtering
- Create debug mode with verbose output

**Files:**
- `src/logging/logger.ts`
- `src/logging/formatters.ts`

**Tests:**
- Log level filtering
- JSON output format
- Debug mode behavior

### Phase 2: MCP Protocol Layer (Week 2-3)

#### Task 2.1: Tool Proxy - Stdio Transport
- Implement stdio transport for spawning upstream server
- Handle process lifecycle (spawn, monitor, restart)
- Parse MCP messages from stdout
- Send requests via stdin

**Files:**
- `src/transport/stdio.ts`
- `src/proxy/tool-proxy.ts`

**Tests:**
- Spawn mock server, exchange messages
- Handle server crash/restart
- Timeout handling

#### Task 2.2: Tool Proxy - SSE Transport
- Implement SSE transport for HTTP-based servers
- Handle connection, reconnection
- Parse SSE event stream

**Files:**
- `src/transport/sse.ts`

**Tests:**
- Connect to mock SSE server
- Handle disconnection/reconnection
- Timeout and error handling

#### Task 2.3: MCP Server Interface
- Implement MCP server using `@modelcontextprotocol/sdk`
- Handle `initialize`, `tools/list`, `tools/call`
- Handle `resources/list`, `resources/read`
- Add `_meta.ui.resourceUri` to tool definitions

**Files:**
- `src/server/mcp-server.ts`
- `src/server/handlers/tools.ts`
- `src/server/handlers/resources.ts`

**Tests:**
- Respond to tools/list with augmented tools
- Proxy tools/call to upstream
- Serve ui:// resources

### Phase 3: UI Generation (Week 3-4)

#### Task 3.1: LLM Provider Abstraction
- Define provider interface
- Implement Anthropic provider
- Implement OpenAI provider
- Implement Ollama provider

**Files:**
- `src/llm/provider.ts`
- `src/llm/anthropic.ts`
- `src/llm/openai.ts`
- `src/llm/ollama.ts`

**Tests:**
- Mock API responses
- Handle rate limits
- Retry logic

#### Task 3.2: Prompt Management
- Load prompt templates from filesystem
- Implement template rendering (Handlebars or simple string replacement)
- Support prompt versioning

**Files:**
- `src/generation/prompts/system.txt`
- `src/generation/prompts/generate.txt`
- `src/generation/prompts/classify.txt`
- `src/generation/prompt-manager.ts`

**Tests:**
- Template rendering with variables
- Refinement history inclusion

#### Task 3.3: UI Generator Core
- Implement generation pipeline
- Handle tool classification (rich vs minimal)
- Integrate with LLM provider
- Implement retry logic

**Files:**
- `src/generation/generator.ts`
- `src/generation/classifier.ts`

**Tests:**
- Generate UI from tool metadata
- Handle LLM errors gracefully
- Classification accuracy

#### Task 3.4: HTML Validation
- Implement HTML parser (use `htmlparser2` or similar)
- Check for required patterns
- Check for forbidden patterns
- Implement repair logic

**Files:**
- `src/generation/validator.ts`
- `src/generation/repair.ts`

**Tests:**
- Detect missing App API
- Detect forbidden patterns
- Repair simple issues

#### Task 3.5: Minimal UI Template
- Create template system for minimal UIs
- Generate form fields from JSON Schema
- Render template with tool metadata

**Files:**
- `src/generation/templates/minimal.html`
- `src/generation/template-renderer.ts`

**Tests:**
- Generate forms for various schemas
- Handle nested objects
- Handle arrays

### Phase 4: Caching (Week 4-5)

#### Task 4.1: Cache Manager
- Implement in-memory LRU cache
- Implement cache key computation
- Add schema hash function
- Add refinement history hash

**Files:**
- `src/cache/manager.ts`
- `src/cache/keys.ts`

**Tests:**
- Cache hit/miss behavior
- LRU eviction
- Key uniqueness

#### Task 4.2: Filesystem Persistence
- Implement save/load from disk
- Handle atomic writes
- Add startup restore

**Files:**
- `src/cache/persistence.ts`

**Tests:**
- Persist and restore cycle
- Handle corrupted files
- Handle missing directory

### Phase 5: Refinement & Introspection (Week 5)

#### Task 5.1: Refinement Manager
- Track refinement history per tool
- Compute history hash
- Clear history on demand

**Files:**
- `src/refinement/manager.ts`

**Tests:**
- Accumulate refinements
- Hash consistency
- Clear individual vs all

#### Task 5.2: Wrapper Tools
- Implement `_ui_refine` handler
- Implement `_ui_list` handler
- Implement `_ui_inspect` handler
- Implement `_ui_regenerate` handler

**Files:**
- `src/server/handlers/wrapper-tools.ts`

**Tests:**
- Refinement triggers regeneration
- List returns correct status
- Inspect returns generation metadata
- Regenerate bypasses cache

### Phase 6: Integration & Polish (Week 5-6)

#### Task 6.1: End-to-End Integration
- Wire all components together
- Handle startup sequence
- Handle shutdown gracefully
- Add health checks

**Files:**
- `src/wrapper.ts` (main entry point)
- `src/index.ts` (exports)

**Tests:**
- Full startup/shutdown cycle
- Proxy tool calls end-to-end
- Generate and serve UI end-to-end

#### Task 6.2: CLI Interface
- Implement `mcp-gen-ui` command
- Support `--upstream`, `--llm`, `--config` flags
- Add `--debug` and `--no-cache` modes
- Add `--export-dir` for UI export

**Files:**
- `src/cli.ts`
- `bin/mcp-gen-ui`

**Tests:**
- CLI argument parsing
- Config file vs CLI precedence
- Debug mode output

#### Task 6.3: Documentation
- Write README with usage examples
- Document configuration options
- Add architecture diagram
- Create troubleshooting guide

**Files:**
- `README.md`
- `docs/configuration.md`
- `docs/troubleshooting.md`

#### Task 6.4: Example Servers
- Create example weather server
- Create example database server
- Add integration test suite using examples

**Files:**
- `examples/weather-server/`
- `examples/database-server/`
- `tests/integration/`

---

## Appendix A: Dependency List

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "commander": "^12.0.0",
    "htmlparser2": "^9.0.0",
    "lru-cache": "^10.0.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "esbuild": "^0.20.0",
    "typescript": "^5.4.0",
    "vitest": "^1.3.0",
    "eslint": "^8.57.0",
    "prettier": "^3.2.0"
  },
  "optionalDependencies": {
    "@anthropic-ai/sdk": "^0.20.0",
    "openai": "^4.28.0"
  }
}
```

---

## Appendix B: File Structure

```
mcp-gen-ui/
├── bin/
│   └── mcp-gen-ui             # CLI entry point
├── src/
│   ├── index.ts               # Public exports
│   ├── wrapper.ts             # Main wrapper class
│   ├── cli.ts                 # CLI implementation
│   ├── config/
│   │   ├── schema.ts          # Config type definitions
│   │   └── loader.ts          # Config loading logic
│   ├── transport/
│   │   ├── base.ts            # Transport interface
│   │   ├── stdio.ts           # Stdio transport
│   │   └── sse.ts             # SSE transport
│   ├── proxy/
│   │   └── tool-proxy.ts      # Tool proxy implementation
│   ├── server/
│   │   ├── mcp-server.ts      # MCP server implementation
│   │   └── handlers/
│   │       ├── tools.ts       # tools/* handlers
│   │       ├── resources.ts   # resources/* handlers
│   │       └── wrapper-tools.ts # _ui_* handlers
│   ├── generation/
│   │   ├── generator.ts       # UI generator core
│   │   ├── classifier.ts      # Rich/minimal classifier
│   │   ├── validator.ts       # HTML validation
│   │   ├── repair.ts          # HTML repair logic
│   │   ├── prompt-manager.ts  # Prompt template handling
│   │   ├── template-renderer.ts # Minimal UI template
│   │   └── prompts/
│   │       ├── system.txt
│   │       ├── generate.txt
│   │       └── classify.txt
│   ├── llm/
│   │   ├── provider.ts        # Provider interface
│   │   ├── anthropic.ts       # Anthropic implementation
│   │   ├── openai.ts          # OpenAI implementation
│   │   └── ollama.ts          # Ollama implementation
│   ├── cache/
│   │   ├── manager.ts         # Cache manager
│   │   ├── keys.ts            # Cache key computation
│   │   └── persistence.ts     # Filesystem persistence
│   ├── refinement/
│   │   └── manager.ts         # Refinement history
│   └── logging/
│       ├── logger.ts          # Structured logger
│       └── formatters.ts      # Log format handlers
├── tests/
│   ├── unit/                  # Unit tests
│   ├── integration/           # Integration tests
│   └── fixtures/              # Test fixtures
├── examples/
│   ├── weather-server/        # Example server
│   └── database-server/       # Example server
├── docs/
│   ├── PRODUCT_SPEC.md        # Product specification
│   ├── PRODUCT_SPEC-design.md # This document
│   ├── configuration.md       # Config documentation
│   └── troubleshooting.md     # Troubleshooting guide
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-01-28 | Vivek Haldar | Initial design document |
