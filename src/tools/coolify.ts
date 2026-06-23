import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { coolify } from "../lib/coolify.js";
import { text, json, safe } from "../lib/result.js";
import { READ_ONLY, WRITE } from "../lib/annotations.js";

export function registerCoolify(server: McpServer) {
  server.registerTool(
    "coolify_servers",
    {
      title: "List Coolify servers",
      description: "List servers connected to your Coolify instance.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    safe(async () => {
      const list = await coolify("/servers");
      const rows = (Array.isArray(list) ? list : []).map(
        (s: any) => `${s.name ?? s.uuid}  ${s.ip ?? ""}  reachable=${s.is_reachable ?? "?"}`
      );
      return rows.length ? text(rows.join("\n")) : json(list);
    })
  );

  server.registerTool(
    "coolify_apps",
    {
      title: "List Coolify apps",
      description: "List applications managed by Coolify (name, status, uuid).",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    safe(async () => {
      const list = await coolify("/applications");
      const rows = (Array.isArray(list) ? list : []).map(
        (a: any) => `${(a.name ?? "?").padEnd(28)} ${(a.status ?? "?").padEnd(14)} ${a.uuid}`
      );
      return rows.length
        ? text(["NAME                         STATUS         UUID", ...rows].join("\n"))
        : json(list);
    })
  );

  server.registerTool(
    "coolify_deploy",
    {
      title: "Trigger deployment",
      description: "Trigger a deployment for an application by its uuid.",
      inputSchema: {
        uuid: z.string().describe("Application uuid (from coolify_apps)"),
        force: z.boolean().default(false).describe("Force rebuild without cache"),
      },
      annotations: WRITE,
    },
    safe(async ({ uuid, force }) => {
      const res = await coolify(`/deploy?uuid=${encodeURIComponent(uuid)}&force=${force}`);
      return json(res);
    })
  );

  server.registerTool(
    "coolify_resources",
    {
      title: "List all resources",
      description: "List all Coolify resources (apps, databases, services) across projects.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    safe(async () => json(await coolify("/resources")))
  );
}
