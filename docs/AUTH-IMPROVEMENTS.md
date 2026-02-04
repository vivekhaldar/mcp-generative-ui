# Auth Improvements for MCP Generative UI Wrapper

## Problem

The wrapper can only authenticate to upstream MCP servers via bearer token over HTTP transport. SSE transport has no auth. The transport/auth coupling is wrong (bearer token presence determines HTTP vs SSE). No custom headers support for APIs that use non-standard auth headers.

## Key Insight

The MCP SDK's `StreamableHTTPClientTransport` already supports auth headers natively via `requestInit`. The custom `HttpClientTransport` in `src/transport/http.ts` is redundant. `SSEClientTransport` is deprecated in favor of `StreamableHTTPClientTransport`.

## Plan: Unified Transport + Custom Headers

### 1. Simplify config transport union (`src/config.ts`)

Replace three transport types with two:

```typescript
upstream:
  | { transport: "stdio"; command: string; args: string[] }
  | { transport: "http"; url: string; headers?: Record<string, string> };
```

- Remove `sse` variant entirely
- Replace `bearerToken` with generic `headers` map
- Add `upstreamHeaders` to `CLIOptions`

### 2. Update `buildConfig()` logic (`src/config.ts`)

Decouple auth from transport selection:

```typescript
if (options.upstreamUrl) {
  const headers: Record<string, string> = {};

  // --upstream-token becomes Authorization header
  const bearerToken = options.upstreamToken || process.env.MCP_UPSTREAM_BEARER_TOKEN;
  if (bearerToken) {
    headers["Authorization"] = `Bearer ${bearerToken}`;
  }

  // --upstream-headers for arbitrary headers (e.g., X-API-Key:abc)
  if (options.upstreamHeaders) {
    for (const h of options.upstreamHeaders) {
      const idx = h.indexOf(":");
      if (idx > 0) {
        headers[h.slice(0, idx).trim()] = h.slice(idx + 1).trim();
      }
    }
  }

  upstream = {
    transport: "http",
    url: options.upstreamUrl,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
  };
}
```

### 3. Add `--upstream-headers` CLI option (`src/index.ts`)

```
.option("--upstream-headers <headers...>", "Custom headers for upstream (key:value, repeatable)")
```

Keep `--upstream-token` as convenient shorthand.

### 4. Replace transport instantiation (`src/server.ts` lines 388-407)

Replace the three-branch transport logic with two branches:

```typescript
if (config.upstream.transport === "stdio") {
  transport = new StdioClientTransport({ ... });
} else {
  transport = new StreamableHTTPClientTransport(
    new URL(config.upstream.url),
    { requestInit: { headers: config.upstream.headers || {} } }
  );
}
```

Update the import on line 6 — remove `SSEClientTransport` and `HttpClientTransport`.

### 5. Delete `src/transport/http.ts`

Entirely replaced by SDK's `StreamableHTTPClientTransport`.

### 6. Clean up `src/transport/base.ts`

Remove `SSEClientTransport` and `HttpClientTransport` exports. Keep `StdioClientTransport` and `StreamableHTTPClientTransport`.

### 7. Auth error detection (`src/server.ts` lines 350-380)

Improve the two catch blocks in `handleToolCall` to detect auth failures:

```typescript
catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  const isAuthError = /\b(401|403|Unauthorized|Forbidden)\b/.test(message);
  return {
    content: [{
      type: "text",
      text: isAuthError
        ? `Authentication failed with upstream server. Check --upstream-token or --upstream-headers. Details: ${message}`
        : `Tool call failed: ${message}`,
    }],
    isError: true,
  };
}
```

### 8. Update tests (`src/config.test.ts`)

- Update existing tests for new config shape (no `sse` transport, `headers` instead of `bearerToken`)
- Add tests for `--upstream-headers` parsing
- Add test that `--upstream-token` becomes Authorization header in headers map
- Add test that explicit headers override token

## Files Changed

| File | Change |
|------|--------|
| `src/config.ts` | New `headers` field, remove `sse`/`bearerToken`, update `buildConfig()` and `CLIOptions` |
| `src/index.ts` | Add `--upstream-headers` CLI option |
| `src/server.ts` | Simplify transport instantiation to 2 branches, update imports, improve error messages |
| `src/transport/base.ts` | Remove `SSEClientTransport` and `HttpClientTransport` exports |
| `src/transport/http.ts` | **Delete** |
| `src/config.test.ts` | Update for new config shape, add header parsing tests |

## What We're NOT Doing (YAGNI)

- **OAuth flows** — deferred to V2. Static tokens/headers cover real usage with Claude Desktop.
- **Token refresh** — deferred. If a token expires, the auth error message tells you what happened.
- **Cache auth-awareness** — V1 is single-user, not needed.
- **Per-tool auth** — different architecture, not in scope.

## Testing Strategy

### Unit Tests

`npm test` — all existing + new config tests pass.

### Manual Testing with Real MCP Servers

Ranked by ease of setup:

#### 1. MCP Framework with `APIKeyAuthProvider` (self-hosted, simplest)

The `mcp-framework` npm package has built-in `APIKeyAuthProvider`. A few lines of TypeScript config gives you an SSE/HTTP server that rejects requests without a valid `X-API-Key` header. Tests that our proxy correctly forwards custom auth headers.

- Repo: https://github.com/QuantGeekDev/mcp-framework
- Docs: https://mcp-framework.com/docs/Authentication/overview/

#### 2. Apify MCP endpoint (hosted, no self-hosting needed)

Real production MCP server at `https://mcp.apify.com/sse` (and `/mcp` for Streamable HTTP) requiring Bearer token auth. Sign up for a free Apify account to get a token.

```bash
# Test bearer token forwarding
mcp-gen-ui --upstream-url https://mcp.apify.com/mcp --upstream-token <APIFY_TOKEN>
```

- Docs: https://docs.apify.com/platform/integrations/mcp

#### 3. Cloudflare Workers MCP template (hosted, OAuth)

Deploy a free Cloudflare Worker with GitHub OAuth. Tests the full OAuth flow (deferred to V2, but useful as a target for future work).

- Guide: https://developers.cloudflare.com/agents/guides/remote-mcp-server/

#### 4. NapthaAI OAuth reference server (self-hosted, full OAuth 2.1)

The closest thing to a canonical MCP OAuth implementation. Supports both SSE and Streamable HTTP. Good for testing OAuth when we get to V2.

- Repo: https://github.com/NapthaAI/http-oauth-mcp-server

### Test Matrix

| Scenario | Transport | Auth Method | Test Target |
|----------|-----------|-------------|-------------|
| No auth (baseline) | stdio | None | `test-servers/weather-server.js` |
| Bearer token | Streamable HTTP | `--upstream-token` | Apify |
| Custom header | Streamable HTTP | `--upstream-headers "X-API-Key:..."` | MCP Framework server |
| Wrong token (error path) | Streamable HTTP | Invalid token | Any authenticated server |
| No token to auth server | Streamable HTTP | None | Any authenticated server |
