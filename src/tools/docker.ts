import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config } from "../config.js";
import { runLocal, runRemoteOn } from "../lib/exec.js";
import { fromExec, safe } from "../lib/result.js";
import { shellQuote, containerSchema } from "../lib/validate.js";
import { READ_ONLY, DESTRUCTIVE } from "../lib/annotations.js";

/** Run docker either locally or over SSH (DOCKER_SSH_TARGET). */
function runDocker(args: string[]) {
  if (config.docker.sshTarget) {
    // Over SSH the args are joined into a single shell command, so each must be
    // quoted to prevent metacharacters (e.g. in a container name) from escaping.
    return runRemoteOn(config.docker.sshTarget, `docker ${args.map(shellQuote).join(" ")}`);
  }
  // Locally, execFile passes args directly to the binary — no shell involved.
  return runLocal("docker", args);
}

export function registerDocker(server: McpServer) {
  server.registerTool(
    "docker_ps",
    {
      title: "List containers",
      description: "List running containers (or all with `all=true`).",
      inputSchema: { all: z.boolean().default(false).describe("Include stopped containers") },
      annotations: READ_ONLY,
    },
    safe(async ({ all }) =>
      fromExec(
        await runDocker([
          "ps",
          ...(all ? ["-a"] : []),
          "--format",
          "table {{.Names}}\\t{{.Status}}\\t{{.Image}}\\t{{.Ports}}",
        ])
      )
    )
  );

  server.registerTool(
    "docker_logs",
    {
      title: "Container logs",
      description: "Show the last N log lines for a container.",
      inputSchema: {
        container: containerSchema.describe("Container name or id"),
        tail: z.number().int().min(1).max(2000).default(100).describe("Lines to show"),
      },
      annotations: READ_ONLY,
    },
    safe(async ({ container, tail }) =>
      fromExec(await runDocker(["logs", "--tail", String(tail), container]))
    )
  );

  server.registerTool(
    "docker_restart",
    {
      title: "Restart container",
      description: "Restart a container by name or id (causes a brief outage).",
      inputSchema: { container: containerSchema.describe("Container name or id") },
      annotations: DESTRUCTIVE,
    },
    safe(async ({ container }) => fromExec(await runDocker(["restart", container])))
  );

  server.registerTool(
    "docker_raw",
    {
      title: "Run docker command",
      description:
        'Run any docker subcommand. Pass arguments as an array, e.g. ["compose", "up", "-d"].',
      inputSchema: { args: z.array(z.string()).min(1).describe("docker arguments as an array") },
      annotations: DESTRUCTIVE,
    },
    safe(async ({ args }) => fromExec(await runDocker(args)))
  );
}
