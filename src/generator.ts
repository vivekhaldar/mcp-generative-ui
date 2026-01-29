// ABOUTME: UI generation using LLM with prompt templates and fallback.
// ABOUTME: Generates HTML UIs for MCP tools and provides minimal fallback on failure.

import type { LLMClient } from "./llm.js";

// Embedded prompts (to work after bundling)
const systemPrompt = `You are a UI generator for OpenAI Apps. Your task is to generate a complete, self-contained HTML file that provides an interactive interface for an MCP tool.

THE HOST PROVIDES window.openai GLOBAL:
The host injects a window.openai object with these properties and methods:
- window.openai.toolOutput - the tool result data (object with content array)
- window.openai.toolInput - the input arguments used to call the tool
- window.openai.callTool(name, args) - call another tool, returns Promise with result
- window.openai.theme - "dark" or "light"

CRITICAL CONSTRAINTS:
- Do NOT import any external modules - use window.openai directly
- Do NOT use inline event handlers (onclick=, onsubmit=, etc.) - use addEventListener only
- Do NOT include any external scripts or stylesheets (except CDN for charts if needed)
- Do NOT use eval(), new Function(), or document.write()
- Do NOT use innerHTML with user data - use textContent for safety
- Use <script> NOT <script type="module"> since there are no imports

REQUIREMENTS:
1. Output a single HTML file with inline <style> and <script>
2. Wait for window.openai to be available before accessing it
3. Read initial data from window.openai.toolOutput and window.openai.toolInput
4. Use window.openai.callTool(name, args) to call tools, await the returned Promise
5. Include error handling with try/catch and display errors to users
6. Style should be clean, functional, and use system fonts
7. The UI must be fully functional without any TODO comments or placeholders
8. Include proper form labels (for accessibility)

IMPORTANT - OUTPUT HANDLING:
- window.openai.toolOutput may be null/undefined initially
- The result from callTool() is the raw tool result (not wrapped)
- ALWAYS include a "Show Raw JSON" toggle as fallback
- Wrap all rendering in try/catch - if parsing/rendering fails, show raw JSON
- The result.content is an array of {type: "text", text: "..."} objects
- Results may be arrays or objects - handle both
- Truncate very large outputs (>100KB) with "Show more" option

IMPORTANT - INPUT HANDLING:
- Coerce form values to correct types (boolean, number, integer)
- Respect JSON Schema constraints when possible (min, max, pattern)
- Pre-fill default values from schema

PATTERN TO WAIT FOR window.openai:
function init() {
  if (!window.openai) {
    window.addEventListener('openai:set-globals', init);
    return;
  }
  // Your initialization code here
}
init();

OUTPUT ONLY THE HTML FILE. No markdown, no explanation, no code fences.`;

const generateTemplate = `Generate a UI for this MCP tool:

===TOOL_DEFINITION_START===
TOOL NAME: {{toolName}}
DESCRIPTION: {{toolDescription}}

INPUT SCHEMA:
{{inputSchema}}
===TOOL_DEFINITION_END===

{{refinements}}

REQUIREMENTS:
- Theme: light
- Create appropriate form controls for each input property
- Handle required vs optional fields appropriately
- Pre-fill default values from schema
- Add loading state while tool is executing
- Show errors clearly with option to retry

OUTPUT HANDLING (CRITICAL):
- You do NOT have an output schema - the tool result structure is UNKNOWN
- Based on the tool name and description, make a reasonable guess at visualization
- For financial/stock data: consider using charts (canvas), tables, or card layouts
- ALWAYS include a "Show Raw JSON" toggle as fallback
- Wrap all rendering code in try/catch
- If rendering fails, fall back to JSON.stringify(result, null, 2)
- Handle ALL content items in the result, not just the first

VISUALIZATION HINTS:
- Stock prices/trends → line chart or candlestick chart
- Lists of items → table or cards
- Single values → large display with label
- Time series → chart with x-axis as time
- Comparisons → bar chart or table

Remember: Output ONLY the complete HTML file, no markdown code fences or explanations.`;

export interface ToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface GeneratorOptions {
  llm: LLMClient;
  timeoutMs?: number;
}

export function createGenerator(options: GeneratorOptions) {
  const { llm, timeoutMs = 30000 } = options;

  return {
    async generate(
      tool: ToolDefinition,
      refinements: string[] = []
    ): Promise<{ html: string; isMinimal: boolean }> {
      try {
        // Build the user prompt
        let userPrompt = generateTemplate
          .replace("{{toolName}}", tool.name)
          .replace("{{toolDescription}}", tool.description || "No description provided")
          .replace("{{inputSchema}}", JSON.stringify(tool.inputSchema, null, 2));

        // Add refinements if any
        if (refinements.length > 0) {
          const refinementText = `USER REFINEMENT REQUESTS (apply ALL of these to the UI):\n${refinements.map((r) => `- ${r}`).join("\n")}`;
          userPrompt = userPrompt.replace("{{refinements}}", refinementText);
        } else {
          userPrompt = userPrompt.replace("{{refinements}}", "");
        }

        console.log(`Generating UI for tool: ${tool.name}...`);

        // Generate with timeout
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const html = await llm.generate(systemPrompt, userPrompt);

          // Strip markdown code fences if present
          let cleanHtml = html.trim();
          if (cleanHtml.startsWith("```html")) {
            cleanHtml = cleanHtml.slice(7);
          } else if (cleanHtml.startsWith("```")) {
            cleanHtml = cleanHtml.slice(3);
          }
          if (cleanHtml.endsWith("```")) {
            cleanHtml = cleanHtml.slice(0, -3);
          }
          cleanHtml = cleanHtml.trim();

          // Basic validation
          if (!cleanHtml.includes("<html") || !cleanHtml.includes("window.openai")) {
            console.warn("Generated HTML appears invalid, using minimal UI");
            return { html: this.minimalUI(tool), isMinimal: true };
          }

          console.log(`Generated UI for ${tool.name} (${cleanHtml.length} bytes)`);
          return { html: cleanHtml, isMinimal: false };
        } finally {
          clearTimeout(timeout);
        }
      } catch (err) {
        console.error(`Failed to generate UI for ${tool.name}:`, err);
        return { html: this.minimalUI(tool), isMinimal: true };
      }
    },

    minimalUI(tool: ToolDefinition): string {
      const schema = tool.inputSchema as {
        properties?: Record<string, { type?: string; description?: string; default?: unknown; enum?: string[] }>;
        required?: string[];
      };
      const properties = schema.properties || {};
      const required = schema.required || [];

      // Generate form fields
      const formFields = Object.entries(properties)
        .map(([name, prop]) => {
          const isRequired = required.includes(name);
          const requiredAttr = isRequired ? "required" : "";
          const requiredClass = isRequired ? 'class="required"' : "";
          const defaultValue = prop.default !== undefined ? `value="${prop.default}"` : "";

          if (prop.enum) {
            const options = prop.enum
              .map((v) => `<option value="${v}">${v}</option>`)
              .join("");
            return `
              <div class="form-group">
                <label for="${name}" ${requiredClass}>${name}</label>
                <select id="${name}" name="${name}" ${requiredAttr}>
                  <option value="">-- Select --</option>
                  ${options}
                </select>
              </div>`;
          }

          if (prop.type === "boolean") {
            return `
              <div class="form-group">
                <label for="${name}" ${requiredClass}>${name}</label>
                <select id="${name}" name="${name}" ${requiredAttr}>
                  <option value="">-- Select --</option>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </div>`;
          }

          if (prop.type === "number" || prop.type === "integer") {
            const step = prop.type === "integer" ? 'step="1"' : 'step="any"';
            return `
              <div class="form-group">
                <label for="${name}" ${requiredClass}>${name}</label>
                <input type="number" id="${name}" name="${name}" ${step} ${defaultValue} ${requiredAttr}
                  placeholder="${prop.description || ""}">
              </div>`;
          }

          return `
            <div class="form-group">
              <label for="${name}" ${requiredClass}>${name}</label>
              <input type="text" id="${name}" name="${name}" ${defaultValue} ${requiredAttr}
                placeholder="${prop.description || ""}">
            </div>`;
        })
        .join("\n");

      return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${tool.name}</title>
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
  </style>
</head>
<body>
  <h1>${tool.name}</h1>
  <p class="description">${tool.description || "No description"}</p>

  <form id="tool-form">
    ${formFields}
    <button type="submit" id="submit-btn">Execute</button>
  </form>

  <div class="loading" id="loading">Executing...</div>
  <div class="error" id="error"></div>
  <div class="result" id="result" style="display: none;">
    <strong>Result:</strong>
    <pre id="result-content"></pre>
  </div>

  <script>
    var schema = ${JSON.stringify(tool.inputSchema)};
    var toolName = "${tool.name}";

    window.onerror = function(msg) {
      document.getElementById('error').textContent = String(msg);
      document.getElementById('error').style.display = 'block';
      document.getElementById('loading').style.display = 'none';
    };

    function renderResult(result) {
      document.getElementById('loading').style.display = 'none';
      document.getElementById('error').style.display = 'none';
      document.getElementById('result').style.display = 'block';
      document.getElementById('submit-btn').disabled = false;

      try {
        var content = result.content || [];
        var output = '';
        for (var i = 0; i < content.length; i++) {
          var item = content[i];
          if (item.type === 'text' && item.text) {
            try {
              var parsed = JSON.parse(item.text);
              output += JSON.stringify(parsed, null, 2) + '\\n';
            } catch (e) {
              output += item.text + '\\n';
            }
          }
        }
        document.getElementById('result-content').textContent = output || JSON.stringify(result, null, 2);
      } catch (e) {
        document.getElementById('result-content').textContent = JSON.stringify(result, null, 2);
      }
    }

    function init() {
      if (!window.openai) {
        window.addEventListener('openai:set-globals', init);
        return;
      }

      // Show initial result if available
      if (window.openai.toolOutput) {
        renderResult(window.openai.toolOutput);
      }

      document.getElementById('tool-form').addEventListener('submit', function(e) {
        e.preventDefault();
        var formData = new FormData(e.target);
        var args = {};

        formData.forEach(function(value, key) {
          if (value === '') return;
          var propSchema = schema.properties && schema.properties[key];
          if (propSchema) {
            if (propSchema.type === 'boolean') {
              args[key] = value === 'true';
            } else if (propSchema.type === 'integer') {
              args[key] = parseInt(value, 10);
            } else if (propSchema.type === 'number') {
              args[key] = parseFloat(value);
            } else {
              args[key] = value;
            }
          } else {
            args[key] = value;
          }
        });

        document.getElementById('loading').style.display = 'block';
        document.getElementById('error').style.display = 'none';
        document.getElementById('result').style.display = 'none';
        document.getElementById('submit-btn').disabled = true;

        window.openai.callTool(toolName, args)
          .then(function(result) {
            renderResult(result);
          })
          .catch(function(err) {
            document.getElementById('loading').style.display = 'none';
            document.getElementById('error').textContent = err.message || 'Tool execution failed';
            document.getElementById('error').style.display = 'block';
            document.getElementById('submit-btn').disabled = false;
          });
      });
    }

    init();
  </script>
</body>
</html>`;
    },
  };
}
