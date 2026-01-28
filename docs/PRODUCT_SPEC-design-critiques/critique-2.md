Below is a hard‑nosed design review in Markdown, organized by the requested categories. I reference exact sections and call out concrete gaps, risks, and improvements.

---

# MCP Generative UI Wrapper – Critical Design Review

## Overall assessment
Solid framing and clearer than v1.0, but still has **serious correctness and security ambiguities**, a few **architectural holes** that will bite you in v1, and **implementation tasks that underestimate complexity** (especially for MCP protocol handling, HTML validation, and UI/runtime robustness). This can work for a demo, but the current plan is not yet “staff‑engineer‑level” for something people will trust.

---

## 1) Completeness

### Missing considerations / edge cases
- **Tool output size and streaming**: You assume outputs fit in memory and are immediately available. MCP tools can return large blobs or large arrays. There’s no handling for backpressure, truncation, paging, or progressive rendering. This is a key omission in **8.1/8.4** and **9.x**.
- **Multiple results / tool calls in flight**: `app.ontoolresult` is one callback. You don’t address correlating results to specific UI submissions (e.g., user submits twice quickly). The minimal template simply overwrites the UI. This is a correctness gap in **8.4**.
- **Result shapes beyond `text/image/error`**: MCP can return other content types. You mention JSON fallback but don’t define a reliable “generic rendering” policy for unknown types. See **8.2 / 8.4**.
- **Tool input constraints**: JSON Schema has `minimum`, `maximum`, `pattern`, `minLength`, `maxLength`, etc. You ignore them. That’s **missing user input validation** in **8.3** and makes many tools hard to use.
- **Schema defaults**: You don’t handle `default` or `examples` for inputs. Missing in **8.3 / 8.4**.
- **Internationalization and locale formatting**: You explicitly exclude i18n in scope, but you still must handle `date/time` formats consistently, especially in `format: "date"` inputs. The minimal template doesn’t address this.
- **Cache invalidation on upstream changes**: You only hash `inputSchema`, but tool `description` changes can materially alter prompts. You should include `description` in the hash; you don’t. See **4.3.3**.
- **Cache staleness on prompt/template updates**: You include `promptVersion` and `systemPromptHash`, but not **template version** (minimal UI template) or **validation rules**. Both can alter output. Missing in **4.3.3** and **8.4**.
- **Tool renaming / removal**: You describe a refresh tool and invalidation by tool name, but you don’t define what happens to old `ui://` resources when a tool is removed (in `resources/list`). This is a correctness/integration hole in **5.2 / 7.1**.
- **SSE transport details**: There’s no mention of authentication refresh, SSE event framing edge cases, or reconnect semantics that preserve in‑flight requests. Missing in **5.2, 7.2.2**.

---

## 2) Correctness

### Technical errors / flawed assumptions
- **Assumes `@modelcontextprotocol/ext-apps` is always available**: This is host‑specific. You say Claude Desktop only, but you still need a fallback or explicit hard failure in **1.4 / 8.2**. As written, the generation will fail for other hosts and you don’t specify error behavior.
- **Validation by regex is too weak for correctness**: You acknowledge security limits but still treat regex “hard failure” as a correctness gate in **8.5 / 10.4**. This will create false positives and unnecessary fallbacks; it will also miss many JS escape forms. This impacts correctness and UX.
- **Type coercion in minimal UI is wrong**: In **8.4**, you say “Type coercion based on schema” but then you store `args[key] = value` without coercion. This will fail for booleans, numbers, integers, and arrays/objects. It’s incorrect.
- **`app.ontoolresult` handling does not support multiple content items**: You fetch first `text` or `image`. What if the result has both? You ignore others. Also, you don’t handle multiple `text` blocks. This is incomplete and will misrender.
- **Schema hash ignores ordering / semantics**: `JSON.stringify(inputSchema)` is not stable across key ordering. You should canonicalize to avoid unnecessary cache misses or collisions. See **4.3.3**.
- **Retry policy interacts poorly with 15s hard timeout**: If you allow `maxAttempts: 3` with backoff, you can easily exceed the 15s “hard timeout” described in **4.3.1**, unless you’re canceling retries. There’s no cancellation model described.
- **`GenerationQueue` comment vs. config**: You have both `GenerationQueue.maxConcurrent` and `GenerationConfig.maxConcurrentGenerations`, but no clear relationship in **7.2.1 / 6.2**. That’s a design inconsistency.

---

## 3) Scalability

### Bottlenecks / scaling risks
- **Single LLM provider + hard timeout**: This design throttles on LLM latency. With just two concurrent generations (**GenerationConfig.maxConcurrentGenerations = 2**), your system falls over quickly with multiple tools or clients. You need a queue policy and backpressure response.
- **Cache size limits are too low for larger tools**: 50 MB total / 500 KB per entry will not scale to even moderate UI complexity or multiple refinements. The minimal UI HTML alone can approach 50–150 KB. This will evict aggressively and thrash. See **5.4 / 6.2**.
- **No multi‑user isolation**: You explicitly say “single‑user,” but any host running multiple sessions will corrupt refinements and cause cache leaks across users. This is a scalability **and** correctness risk in **1.4 / 5.5**.
- **SSE transport scalability**: No mention of connection pooling or SSE backpressure. SSE is prone to connection limits; you should consider a single upstream connection vs. per request.
- **Tool refresh every 5 minutes**: If the upstream server has heavy tools/list overhead, you could create constant load. There’s no adaptive mechanism or caching of tool list. See **5.2**.

---

## 4) Security

### Vulnerabilities / concerns
- **Prompt injection is still likely**: Delimiter‑based isolation is not strong enough against jailbreak‑style prompt injection. You acknowledge this, but mitigation is minimal and no explicit “safe fallback” when the model output seems contaminated. See **10.3**.
- **Validation bypass**: You list known bypasses in **10.4** but still rely on regex as a gate. That is not defense in depth; it’s a placebo. If the host sandbox is the only real defense, you should explicitly disable any UI features that may be dangerous, e.g., sanitize `innerHTML` usage. Your example UIs use `innerHTML` in the “rich” example, which is risky even in sandbox.
- **Data exfiltration via tool calls**: You assume no network, but tools can be called from UI; a malicious UI could repeatedly call tools with sensitive data. There is no rate limiting or user confirmation. That’s a major security hole in **10.2 / 7.1**.
- **LLM prompt logging in debug**: In **11.3**, you log raw prompts and responses. Those can contain tool metadata or user data. You need redaction or a warning banner.
- **Config supports `apiKey` in file**: You say “not recommended,” but this is still a foot‑gun. There’s no guidance to disable logging of config or environment. See **10.5**.

---

## 5) Maintainability

### Long‑term maintainability issues
- **Hand‑rolled HTML validation / repair**: You’re building a custom validator, repairer, and template renderer. That’s a lot of brittle code. You acknowledge future AST parsing but you still do regex in v1. This is a maintenance sink. See **8.5 / 10.4 / 3.4 tasks**.
- **Two sources of truth for UI logic**: Minimal UI template and generated rich UI each implement result rendering logic differently, creating divergent behaviors. That’s a maintenance and consistency problem in **8.4 vs. generated output**.
- **Inconsistent config schema vs. TypeScript**: Your `WrapperConfig` includes fields not represented in the JSON schema (e.g., `generation.timeoutMs`, `generation.maxConcurrentGenerations`, `cache.maxEntrySizeBytes`, `cache.maxTotalSizeBytes`, `logging.file` required when destination is file). This mismatch is a correctness + maintenance issue in **6.2 / 6.3**.
- **Multiple places define limits**: `GenerationLimits`, `GenerationConfig`, and the system prompt all specify constraints. These can drift and must be centralized.

---

## 6) Complexity

### Over‑engineered / under‑engineered
- **Under‑engineered**: 
  - HTML validation and sanitization (too weak for security).
  - Tool result handling (no correlation or robust type handling).
  - Schema handling (far too simplistic for real tools).
- **Over‑engineered**:
  - Extensive caching + persistence + LRU + versioning for a single‑user v1; if your goal is rapid iteration, that’s more complex than needed.
  - Multiple wrapper tools `_ui_*` before you have core reliability — too much surface area to harden.
- **Mismatch**: The system tries to do “rich UIs” but the absence of output schemas makes this extremely brittle. That’s a fundamental product/design tension.

---

## 7) Alternatives Not Considered (or under‑considered)

- **“Output schema via sampling”**: Before generating UI, you could call the tool with a safe sample input or a `--dry-run` if supported, then infer a schema. This would dramatically improve correctness of UI rendering. You explicitly say output schema is unavailable, but you do not consider active inference.
- **Prebuilt component library**: The doc rejects templates as too inflexible, but a hybrid library of reusable components (forms, tables, JSON viewers) plus a constrained DSL could reduce security risk and increase maintainability.
- **Server‑side rendering of UI**: Instead of exposing raw HTML and JS to the host, generate a structured representation or SSR and only allow a limited JS runtime. This would reduce XSS risk.
- **Allow list of tools for UI generation**: For safety, allow the user to opt‑in which tools get UIs. You currently default to wrapping all tools (**4.2.1**), which is risky for admin/destructive tools.
- **Prompt‑based unit tests**: Run the UI generator with fixed prompts and compare snapshots (e.g., HTML diff). That would give early signals for regressions, but you have no test strategy in **13** for generated UI stability.

---

## 8) Implementation Task Breakdown

### Realism / completeness
- **Tasks underestimate protocol complexity**: Implementing MCP stdio and SSE is non‑trivial (framing, partial messages, reconnect semantics). Your test tasks are too shallow for this. See **Phase 2**.
- **UI generation tests are vague**: “Classification accuracy” is not measurable. You need deterministic test prompts + goldens, or you need contract tests that verify the HTML includes required pieces. See **Phase 3.3 / 3.4**.
- **No explicit cancellation / timeout enforcement**: You mention 15s hard timeout, but no implementation tasks include cancellation support (abort controller, LLM SDK support). This is a major gap in **Phase 3** and **9.2**.
- **Missing performance/latency testing**: Nothing in tasks addresses latency benchmarks or end‑to‑end perf tests, which are critical with LLM calls.
- **No security testing**: Given the threat model, you should plan tests for forbidden patterns, prompt injection scenarios, and sandbox bypass attempts. Only limited regex tests are mentioned in **3.4**.
- **No “tool refresh” behavior tests**: In **5.2**, you mention refresh logic but not edge cases: tool removed, tool renamed, schema changes while UI in cache.

---

# Specific Section‑by‑Section Critiques

### **Section 1.4 (Target Hosts and Assumptions)**
- You assume host sandbox behavior but don’t include a **hard fail** when sandbox guarantees aren’t present. This is a correctness and security risk.
- You assume ES module resolution for `@modelcontextprotocol/ext-apps`, but there is no detection mechanism.

### **Section 2.4 (Output Visualization)**
- You correctly highlight output schema absence, but you do not propose any method to infer or test it. This is a major product gap.
- “Rich” UI without output schema is frequently wrong; the design should strongly bias to minimal UI unless proven otherwise.

### **Section 4.3.1 (Hard Timeout)**
- No cancellation mechanism or guaranteed time budget. You may still spend 30–45s with retries.
- You cache minimal UI on timeout and require `_ui_regenerate`, but you have no auto‑retry or background retry strategy.

### **Section 4.3.3 (Cache Key Design)**
- Excludes tool description and any prompt template versions besides system prompt. This can serve stale UIs.
- Hashing `JSON.stringify` is non‑deterministic across key order.

### **Section 5.2 (Tool Proxy)**
- Refresh interval is fixed; no adaptation for upstream load.
- No statement about how tool removal affects existing ui resources.

### **Section 8.4 (Minimal UI Template)**
- Type coercion not implemented.
- No validation for min/max or pattern.
- No result correlation; repeated calls overwrite output.
- Uses `innerHTML` in rich example (unsafe even in sandbox).

### **Section 8.5 / 10.4 (Validation)**
- Regex‑based validation is insufficient and can be bypassed. You acknowledge this, but you still treat it as hard enforcement. This is a weak design.

### **Section 9 (Error Handling Strategy)**
- Errors are categorized, but no structured escalation path for multiple failures.
- No correlation of errors to tool calls in the UI.

### **Section 11.3 (Debug Mode)**
- Logging raw prompts and responses is an explicit data‑leak risk. Need redaction or warning.

### **Section 13 (Implementation)**
- Missing tasks for cancellation, concurrency stress testing, and security testing.
- “Example servers” are nice, but they don’t validate core LLM output correctness.

---

# Concrete Recommendations (High‑Priority)

1. **Add output inference**: Before generating UI, run a safe “dry” tool call or request a sample from the upstream server to infer output structure. At least allow a config hook that provides output schema per tool.
2. **Hard enforce cancellation**: Use an abortable LLM request with total time budget and ensure retry policy respects it. Add explicit tasks in Phase 3.
3. **Fix cache key**: Include `tool.description`, prompt template version(s), and any “minimal UI template version.”
4. **Improve minimal UI correctness**: Implement type coercion, schema default handling, and constraints for common JSON Schema fields.
5. **Add result correlation**: Include a client‑side request ID and match incoming results; allow multiple in‑flight calls.
6. **Security: explicit allow‑list**: Allow users to restrict which tools are UI‑enabled, and default to deny for destructive/admin tools.
7. **Upgrade validation**: If you keep regex in v1, downgrade its role (warn + fallback), but do not claim it’s a robust security gate. Add a roadmap item and tests for AST validation.
8. **Testing strategy**: Add “golden” tests for generated HTML and integration tests for LLM cancellations.

---

# Summary Verdict

This is a promising architecture but still **missing critical correctness and security mechanisms** and has **incomplete implementation planning**. The biggest technical debt risk is the **fragility of UI generation without output schemas** and the **weak HTML validation model**. If you want v1 to be safe and predictable for real users, you need to tighten these areas before shipping.