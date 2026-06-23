import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runRemote } from "./lib/exec.js";

/** Read-only MCP resources the model can pull without invoking a tool. */
export function registerResources(server: McpServer) {
  server.registerResource(
    "fleet-inventory",
    "fleet://inventory",
    {
      title: "Fleet inventory",
      description: "Live list of Plesk domains and available PHP handlers on the server.",
      mimeType: "text/plain",
    },
    async (uri) => {
      const r = await runRemote(
        "echo '=== domains ==='; plesk bin domain --list 2>/dev/null; " +
          "echo; echo '=== php handlers ==='; plesk bin php_handler --list 2>/dev/null | awk 'NR>1{print $1}'"
      );
      return {
        contents: [{ uri: uri.href, text: r.stdout || r.stderr || "(no output)" }],
      };
    }
  );
}
