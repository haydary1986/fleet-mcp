import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runRemote } from "../lib/exec.js";
import { fromExec, safe } from "../lib/result.js";
import { DESTRUCTIVE } from "../lib/annotations.js";

export function registerSsh(server: McpServer) {
  server.registerTool(
    "run_ssh",
    {
      title: "Run SSH command",
      description:
        "Run a shell command on the fleet server over SSH (FLEET_SSH_TARGET). " +
        "Powerful and can change server state — prefer a specific tool when one exists.",
      inputSchema: {
        command: z.string().min(1).describe("Shell command to execute on the remote server"),
      },
      annotations: DESTRUCTIVE,
    },
    safe(async ({ command }) => fromExec(await runRemote(command)))
  );
}
