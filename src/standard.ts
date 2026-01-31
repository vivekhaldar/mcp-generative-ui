// ABOUTME: Defines standard profiles for OpenAI Apps SDK and MCP Apps.
// ABOUTME: Centralizes all standard-specific values: URIs, MIME types, metadata, prompts.

const sharedDesignGuidance = `
DESIGN PHILOSOPHY:
- Data visualization first, form second — output display is the hero
- No walls of text — use cards, badges, charts, meters instead of paragraphs
- Fully implemented — no placeholder text, no TODOs, no "coming soon"
- Compact and scannable — this is a widget in a conversation, not a full-page app
- Visually distinct — use color, hierarchy, whitespace; avoid generic admin-dashboard aesthetics

WHAT NOT TO DO:
- Don't dump raw JSON as primary display (JSON is only for the fallback toggle)
- Don't create a wall of identical form fields with no visual hierarchy
- Don't use placeholder data or lorem ipsum
- Don't generate more than one screenful for simple data
- Don't use alert()/confirm() — render feedback inline

STYLING GUIDELINES:
- Use CSS custom properties for theming (--primary, --bg, --text, --accent, --success, --error)
- Pick 1 accent color that suits the data domain — not always blue
- Compact spacing (12-16px padding, 8-12px gaps) — this is a widget
- Responsive: may be 300-600px wide, use flex/grid
- Subtle transitions on interactive elements (0.15s ease)
- Form inputs should be compact and visually subordinate to data display

COMMON MISTAKES TO AVOID:
- Forgetting to handle null/undefined toolOutput on initial load
- Using innerHTML with user data (XSS) — use textContent
- Generating chart library from scratch instead of Canvas API for simple charts
- All form fields in single vertical column when horizontal grouping is more compact
- Missing loading states — always show spinner while awaiting results`;

export type StandardName = "openai" | "mcp-apps";

export interface StandardProfile {
  name: StandardName;
  uriPrefix: string;
  mimeType: string;
  buildToolMeta(resourceUri: string): Record<string, unknown>;
  systemPrompt: string;
  validationMarker: string;
  useStructuredContent: boolean;
}

const openaiSystemPrompt = `You are a UI generator for OpenAI Apps. Your task is to generate a complete, self-contained HTML file that provides an interactive interface for an MCP tool.

THE HOST PROVIDES window.openai GLOBAL:
The host injects a window.openai object with these properties and methods:
- window.openai.toolOutput - the tool result data (ALREADY PARSED as JavaScript object, NOT wrapped in content array)
- window.openai.toolInput - the input arguments used to call the tool
- window.openai.callTool(name, args) - call another tool, returns Promise with result containing structuredContent
- window.openai.theme - "dark" or "light"

CRITICAL - toolOutput FORMAT:
- toolOutput is the PARSED data object directly, e.g., {city: "Boston", temperature: 53, condition: "Sunny"}
- It is NOT wrapped in {content: [{type: "text", text: "..."}]} - the host already parsed it
- Access fields directly: window.openai.toolOutput.temperature, window.openai.toolOutput.city, etc.

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
6. Follow the DESIGN PHILOSOPHY and STYLING GUIDELINES below
7. The UI must be fully functional without any TODO comments or placeholders
8. Include proper form labels (for accessibility)

${sharedDesignGuidance}

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

const mcpAppsSystemPrompt = `You are a UI generator for MCP Apps. Your task is to generate a complete, self-contained HTML file that provides an interactive interface for an MCP tool.

THE HOST PROVIDES THE App CLASS:
The host provides the @modelcontextprotocol/ext-apps module. Import and use it as follows:
  import { App } from "@modelcontextprotocol/ext-apps";
  const app = new App({ name: "tool-name", description: "Tool description" });

App API:
- app.ontoolresult = (result) => { ... } - callback receiving tool execution results
- app.callServerTool({ name, arguments }) - invoke a tool, returns Promise
- app.connect() - establish connection with host (call LAST, after setting up handlers)

CRITICAL CONSTRAINTS:
- The @modelcontextprotocol/ext-apps module is provided by the host - do NOT use a CDN URL
- Do NOT use inline event handlers (onclick=, onsubmit=, etc.) - use addEventListener only
- Do NOT include any external scripts or stylesheets
- Do NOT use eval(), new Function(), or document.write()
- Do NOT access parent, top, or opener
- Do NOT use innerHTML with user data - use textContent for safety

REQUIREMENTS:
1. Output a single HTML file with inline <style> and <script type="module">
2. Import as: import { App } from "@modelcontextprotocol/ext-apps";
3. Initialize the App and call app.connect() AFTER setting up ontoolresult handler
4. Implement app.ontoolresult to receive and render tool results
5. Provide an input form to invoke the tool with new parameters
6. Use app.callServerTool({ name, arguments }) to call tools from the UI
7. Include error handling with try/catch and display errors to users
8. Follow the DESIGN PHILOSOPHY and STYLING GUIDELINES below
9. The UI must be fully functional without any TODO comments or placeholders
10. Include proper form labels (for accessibility)

${sharedDesignGuidance}

IMPORTANT - OUTPUT HANDLING:
- Tool results arrive via app.ontoolresult callback
- Result has .content array with {type: "text", text: "..."} items
- ALWAYS include a "Show Raw JSON" toggle as fallback
- Wrap all rendering in try/catch - if parsing/rendering fails, show raw JSON
- Handle ALL content items in the result array, not just the first one
- Results may be arrays or objects - handle both
- Truncate very large outputs (>100KB) with "Show more" option

IMPORTANT - INPUT HANDLING:
- Coerce form values to correct types (boolean, number, integer)
- Respect JSON Schema constraints when possible (min, max, pattern)
- Pre-fill default values from schema

INITIALIZATION PATTERN:
import { App } from "@modelcontextprotocol/ext-apps";
const app = new App({ name: "tool-name", description: "Tool UI" });
app.ontoolresult = (result) => {
  // render result.content
};
await app.connect();

OUTPUT ONLY THE HTML FILE. No markdown, no explanation, no code fences.`;

const openaiProfile: StandardProfile = {
  name: "openai",
  uriPrefix: "ui://",
  mimeType: "text/html",
  buildToolMeta(resourceUri: string) {
    return {
      "openai/outputTemplate": resourceUri,
      "openai/widgetAccessible": true,
    };
  },
  systemPrompt: openaiSystemPrompt,
  validationMarker: "window.openai",
  useStructuredContent: true,
};

const mcpAppsProfile: StandardProfile = {
  name: "mcp-apps",
  uriPrefix: "ui://",
  mimeType: "text/html;profile=mcp-app",
  buildToolMeta(resourceUri: string) {
    return {
      ui: { resourceUri },
    };
  },
  systemPrompt: mcpAppsSystemPrompt,
  validationMarker: "@modelcontextprotocol/ext-apps",
  useStructuredContent: false,
};

const profiles: Record<StandardName, StandardProfile> = {
  openai: openaiProfile,
  "mcp-apps": mcpAppsProfile,
};

export function getStandardProfile(name: StandardName): StandardProfile {
  const profile = profiles[name];
  if (!profile) {
    throw new Error(`Unknown standard: ${name}. Must be "openai" or "mcp-apps".`);
  }
  return profile;
}
