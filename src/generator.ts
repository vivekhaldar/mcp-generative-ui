// ABOUTME: UI generation using LLM with prompt templates and fallback.
// ABOUTME: Generates HTML UIs for MCP tools and provides minimal fallback on failure.

import type { LLMClient } from "./llm.js";
import { getStandardProfile, type StandardName, type StandardProfile } from "./standard.js";

// Generation prompt template (standard-agnostic)
// The system prompt is provided by the StandardProfile.

const openaiOutputHandling = `OUTPUT HANDLING (CRITICAL):
- window.openai.toolOutput contains the ALREADY-PARSED data object directly
- The sample output above shows the EXACT structure of toolOutput
- Access fields directly: toolOutput.temperature, toolOutput.city, toolOutput.condition, etc.
- DO NOT try to parse toolOutput.content or toolOutput.text - the data is ALREADY an object
- Design your UI to display ALL fields from the sample output in a meaningful way
- ALWAYS include a "Show Raw JSON" toggle as fallback
- Wrap all rendering code in try/catch
- If rendering fails, fall back to JSON.stringify(window.openai.toolOutput, null, 2)`;

const mcpAppsOutputHandling = `OUTPUT HANDLING (CRITICAL):
- Tool results arrive via app.ontoolresult callback as {content: [{type: "text", text: "..."}]}
- Parse the text content as JSON to get the data object
- The sample output above shows the EXACT data structure inside result.content[0].text
- Design your UI to display ALL fields from the sample output in a meaningful way
- ALWAYS include a "Show Raw JSON" toggle as fallback
- Wrap all rendering code in try/catch
- If rendering fails, fall back to showing raw JSON`;

function getGenerateTemplate(profileName: StandardName): string {
  const outputHandling = profileName === "openai" ? openaiOutputHandling : mcpAppsOutputHandling;

  return `Generate a UI for this MCP tool.

Before writing any HTML, think through your approach in an XML block that will be stripped from the output:
<planning>
1. What is the PRIMARY data to visualize? How should it look at a glance?
2. What interactive elements does the user need? (form inputs, toggles, pagination)
3. What color/visual theme fits this data domain?
</planning>

Then output ONLY the complete HTML file starting with <!DOCTYPE html>. No other text before or after the HTML.

===TOOL_DEFINITION_START===
TOOL NAME: {{toolName}}
DESCRIPTION: {{toolDescription}}

INPUT SCHEMA:
{{inputSchema}}
===TOOL_DEFINITION_END===

{{sampleOutput}}

{{refinements}}

REQUIREMENTS:
- Theme: light
- Create appropriate form controls for each input property
- Handle required vs optional fields appropriately
- Pre-fill default values from schema
- Add loading state while tool is executing
- Show errors clearly with option to retry

${outputHandling}

VISUALIZATION GUIDANCE:
Choose the best pattern for the data. Mix patterns when data calls for it.

SINGLE VALUE (temperature, price, score):
→ Large prominent number with unit, label above, optional trend indicator

KEY-VALUE PAIRS (weather, profile, config):
→ Card layout with icon/emoji per field, grouped logically, important values emphasized

LISTS/ARRAYS (search results, files, entries):
→ Compact cards or table rows with count badge. Paginate if >10 items.

TIME SERIES (history, metrics over time):
→ Line/area chart via Canvas API. Show current value prominently. Label axes.

COMPARISONS (A vs B, rankings):
→ Horizontal bar chart or side-by-side cards with visual size encoding

NESTED/HIERARCHICAL (trees, deep objects):
→ Collapsible sections. Start collapsed for deep nesting.

STATUS/BOOLEAN (health checks, flags):
→ Color-coded badges (green/red/yellow) with labels

ALWAYS: Use icons/emoji for categories, color for status, bold for key values.

DATA HANDLING PITFALLS:
- Time series data: ALWAYS sort by date ascending (oldest first, newest last) for charts.
  Never reverse chronological data for chart display — the X-axis should go left (old) to right (new).
- Percentage values: Financial APIs often return percentages as decimals (e.g., 0.0025 = 0.25%).
  Check the sample output to determine if values are already percentages or need conversion.
  If a "yield" or "margin" value is < 1 in the sample data, it's likely already a ratio — multiply by 100.
  If it's already > 1 (like 25.5), it's already a percentage — do NOT multiply by 100.

Remember: Output ONLY the complete HTML file, no markdown code fences or explanations.`;
}

export interface ToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  sampleOutput?: unknown; // Sample output from calling the tool - helps LLM generate better UI
}

export interface GeneratorOptions {
  llm: LLMClient;
  standard?: StandardName;
  timeoutMs?: number;
}

export function createGenerator(options: GeneratorOptions) {
  const { llm, standard = "mcp-apps", timeoutMs = 30000 } = options;
  const profile = getStandardProfile(standard);

  return {
    async generate(
      tool: ToolDefinition,
      refinements: string[] = []
    ): Promise<{ html: string; isMinimal: boolean }> {
      try {
        // Build the user prompt
        let userPrompt = getGenerateTemplate(profile.name)
          .replace("{{toolName}}", tool.name)
          .replace("{{toolDescription}}", tool.description || "No description provided")
          .replace("{{inputSchema}}", JSON.stringify(tool.inputSchema, null, 2));

        // Add sample output if available
        if (tool.sampleOutput) {
          const sampleText = `===SAMPLE_OUTPUT_START===
This is a REAL example of what the tool returns:
${JSON.stringify(tool.sampleOutput, null, 2)}
===SAMPLE_OUTPUT_END===

IMPORTANT: Design the UI to visualize ALL the fields shown in this sample output.`;
          userPrompt = userPrompt.replace("{{sampleOutput}}", sampleText);
        } else {
          userPrompt = userPrompt.replace("{{sampleOutput}}", "NOTE: No sample output available. Make a reasonable guess at the output structure based on the tool name and description.");
        }

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
          const html = await llm.generate(profile.systemPrompt, userPrompt);

          // Strip any preamble text (planning, markdown fences, etc.) before the HTML
          let cleanHtml = html.trim();

          // Strip markdown code fences if present
          if (cleanHtml.startsWith("```html")) {
            cleanHtml = cleanHtml.slice(7);
          } else if (cleanHtml.startsWith("```")) {
            cleanHtml = cleanHtml.slice(3);
          }
          if (cleanHtml.endsWith("```")) {
            cleanHtml = cleanHtml.slice(0, -3);
          }
          cleanHtml = cleanHtml.trim();

          // Strip everything before <!DOCTYPE or <html (LLM planning text, explanations, etc.)
          const doctypeIndex = cleanHtml.indexOf("<!DOCTYPE");
          const htmlTagIndex = cleanHtml.indexOf("<html");
          const htmlStart = doctypeIndex >= 0 ? doctypeIndex
            : htmlTagIndex >= 0 ? htmlTagIndex
            : -1;
          if (htmlStart > 0) {
            cleanHtml = cleanHtml.slice(htmlStart);
          }

          // Strip anything after closing </html> tag
          const htmlEndIndex = cleanHtml.lastIndexOf("</html>");
          if (htmlEndIndex >= 0) {
            cleanHtml = cleanHtml.slice(0, htmlEndIndex + "</html>".length);
          }

          cleanHtml = cleanHtml.trim();

          // Basic validation
          if (!cleanHtml.includes("<html") || !cleanHtml.includes(profile.validationMarker)) {
            console.warn(`Generated HTML appears invalid (missing "${profile.validationMarker}"), using minimal UI`);
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
      if (profile.name === "mcp-apps") {
        return this.minimalMcpAppsUI(tool);
      }
      return this.minimalOpenaiUI(tool);
    },

    minimalOpenaiUI(tool: ToolDefinition): string {
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

    minimalMcpAppsUI(tool: ToolDefinition): string {
      const schema = tool.inputSchema as {
        properties?: Record<string, { type?: string; description?: string; default?: unknown; enum?: string[] }>;
        required?: string[];
      };
      const properties = schema.properties || {};
      const required = schema.required || [];

      // Generate form fields (same structure as OpenAI variant)
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

  <script type="module">
    import { App } from "@modelcontextprotocol/ext-apps";

    var schema = ${JSON.stringify(tool.inputSchema)};
    var toolName = "${tool.name}";

    var app = new App({ name: toolName, description: "${(tool.description || "").replace(/"/g, '\\"')}" });

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

    app.ontoolresult = function(result) {
      renderResult(result);
    };

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

      app.callServerTool({ name: toolName, arguments: args })
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

    await app.connect();
  </script>
</body>
</html>`;
    },
  };
}
