// Quick test to verify upstream connection
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
if (!apiKey) {
  console.error("Set ALPHA_VANTAGE_API_KEY environment variable");
  process.exit(1);
}

const url = `https://mcp.alphavantage.co/mcp?apikey=${apiKey}`;
console.log("Connecting to:", url);

const client = new Client(
  { name: "test-client", version: "1.0.0" },
  { capabilities: {} }
);

const transport = new StreamableHTTPClientTransport(new URL(url));

try {
  await client.connect(transport);
  console.log("Connected!");

  const tools = await client.listTools();
  console.log("\nTools discovered:");
  for (const tool of tools.tools) {
    console.log(`  - ${tool.name}: ${tool.description?.slice(0, 60)}...`);
  }

  // Try calling TOOL_LIST to see available Alpha Vantage functions
  console.log("\n\nCalling TOOL_LIST to see available functions...");
  const result = await client.callTool({ name: "TOOL_LIST", arguments: {} });
  console.log("Available functions:", JSON.stringify(result, null, 2).slice(0, 2000));

  await client.close();
  console.log("\nDisconnected successfully");
} catch (err) {
  console.error("Error:", err);
  process.exit(1);
}
