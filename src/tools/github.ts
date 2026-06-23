import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runLocal } from "../lib/exec.js";
import { fromExec, safe } from "../lib/result.js";
import { READ_ONLY, WRITE, DESTRUCTIVE } from "../lib/annotations.js";

// Uses the `gh` CLI, which handles auth. If GITHUB_TOKEN is set it is picked up
// automatically from the environment; otherwise `gh auth login` must be done once.

export function registerGithub(server: McpServer) {
  server.registerTool(
    "gh",
    {
      title: "Run gh CLI",
      description:
        "Run any GitHub CLI command. Pass arguments as an array (no shell parsing), " +
        'e.g. ["repo", "view", "owner/name"].',
      inputSchema: {
        args: z.array(z.string()).min(1).describe("gh arguments as an array"),
      },
      annotations: DESTRUCTIVE,
    },
    safe(async ({ args }) => fromExec(await runLocal("gh", args)))
  );

  server.registerTool(
    "gh_pr_list",
    {
      title: "List pull requests",
      description: "List open pull requests for a repository.",
      inputSchema: {
        repo: z.string().describe("owner/name"),
        state: z.enum(["open", "closed", "merged", "all"]).default("open"),
        limit: z.number().int().min(1).max(100).default(30),
      },
      annotations: READ_ONLY,
    },
    safe(async ({ repo, state, limit }) =>
      fromExec(
        await runLocal("gh", [
          "pr",
          "list",
          "--repo",
          repo,
          "--state",
          state,
          "--limit",
          String(limit),
        ])
      )
    )
  );

  server.registerTool(
    "gh_create_issue",
    {
      title: "Create issue",
      description: "Open a new issue in a repository.",
      inputSchema: {
        repo: z.string().describe("owner/name"),
        title: z.string().describe("Issue title"),
        body: z.string().default("").describe("Issue body (markdown)"),
      },
      annotations: WRITE,
    },
    safe(async ({ repo, title, body }) =>
      fromExec(
        await runLocal("gh", ["issue", "create", "--repo", repo, "--title", title, "--body", body])
      )
    )
  );
}
