import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config } from "../config.js";
import { runLocal, runRemoteOn } from "../lib/exec.js";
import { fromExec, safe } from "../lib/result.js";

/** Run docker either locally or over SSH (DOCKER_SSH_TARGET). */
function runDocker(args: string[]) {
  if (config.docker.sshTarget) {
    return runRemoteOn(config.docker.sshTarget, `docker ${args.join(" ")}`);
  }
  return runLocal("docker", args);
}

export function registerDocker(server: McpServer) {
  server.registerTool(
    "docker_ps",
    {
      title: "List containers",
      description: "List running containers (or all with `all=true`).",
      inputSchema: { all: z.boolean().default(false).describe("Include stopped containers") },
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
        container: z.string().describe("Container name or id"),
        tail: z.number().int().min(1).max(2000).default(100).describe("Lines to show"),
      },
    },
    safe(async ({ container, tail }) =>
      fromExec(await runDocker(["logs", "--tail", String(tail), container]))
    )
  );

  server.registerTool(
    "docker_restart",
    {
      title: "Restart container",
      description: "Restart a container by name or id.",
      inputSchema: { container: z.string().describe("Container name or id") },
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
    },
    safe(async ({ args }) => fromExec(await runDocker(args)))
  );
}
