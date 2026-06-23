import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config } from "../config.js";
import { runLocal } from "../lib/exec.js";
import { text, safe } from "../lib/result.js";
import { READ_ONLY } from "../lib/annotations.js";

// CLIs the various tool groups shell out to. Presence is checked with `command -v`.
const REQUIRED_CLIS = ["ssh", "curl", "openssl"] as const;
const OPTIONAL_CLIS = ["gh", "docker", "mysql", "mysqldump", "wget", "python3"] as const;

/** Which integrations have the env they need to be usable. */
function integrationStatus(): Array<{ name: string; configured: boolean; detail: string }> {
  const cf = config.cloudflare;
  return [
    {
      name: "ssh",
      configured: !!config.ssh.target,
      detail: config.ssh.target || "set FLEET_SSH_TARGET",
    },
    {
      name: "cloudflare",
      configured: cf.length > 0,
      detail: cf.length ? `accounts: ${cf.map((a) => a.key).join(", ")}` : "set CF_ACCOUNTS",
    },
    {
      name: "coolify",
      configured: !!(config.coolify.baseUrl && config.coolify.token),
      detail: config.coolify.baseUrl || "set COOLIFY_BASE_URL + COOLIFY_TOKEN",
    },
    {
      name: "docker",
      configured: true,
      detail: config.docker.sshTarget ? `over ssh: ${config.docker.sshTarget}` : "local",
    },
    {
      name: "github",
      configured: true,
      detail: config.github.token ? "GITHUB_TOKEN set" : "uses gh CLI auth",
    },
    {
      name: "mysql",
      configured: true,
      detail: config.mysql.user ? `user: ${config.mysql.user}` : "server default auth",
    },
  ];
}

async function checkClis(names: readonly string[]): Promise<Record<string, boolean>> {
  const r = await runLocal("bash", [
    "-lc",
    `for c in ${names.join(" ")}; do command -v "$c" >/dev/null 2>&1 && echo "$c=1" || echo "$c=0"; done`,
  ]);
  const out: Record<string, boolean> = {};
  for (const line of r.stdout.split("\n")) {
    const [name, val] = line.trim().split("=");
    if (name) out[name] = val === "1";
  }
  return out;
}

export function registerDoctor(server: McpServer) {
  server.registerTool(
    "fleet_doctor",
    {
      title: "Preflight / self-check",
      description:
        "Diagnose the server's readiness: which local CLIs are installed, which " +
        "integrations are configured, and (optionally) whether the fleet SSH target " +
        "is reachable. Run this first when a tool is failing for unclear reasons.",
      inputSchema: {
        checkSsh: z
          .boolean()
          .default(true)
          .describe("Also test SSH connectivity to FLEET_SSH_TARGET (5s timeout)"),
      },
      annotations: READ_ONLY,
    },
    safe(async ({ checkSsh }) => {
      const clis = await checkClis([...REQUIRED_CLIS, ...OPTIONAL_CLIS]);
      const lines: string[] = ["=== Local CLIs ==="];
      for (const c of REQUIRED_CLIS) {
        lines.push(`  ${clis[c] ? "✓" : "✗"} ${c}${clis[c] ? "" : "  (REQUIRED — install it)"}`);
      }
      for (const c of OPTIONAL_CLIS) {
        lines.push(`  ${clis[c] ? "✓" : "·"} ${c}${clis[c] ? "" : "  (optional)"}`);
      }

      lines.push("", "=== Integrations ===");
      for (const i of integrationStatus()) {
        lines.push(`  ${i.configured ? "✓" : "·"} ${i.name.padEnd(11)} ${i.detail}`);
      }

      lines.push("", "=== SSH connectivity ===");
      if (!checkSsh) {
        lines.push("  (skipped)");
      } else if (!config.ssh.target) {
        lines.push("  · FLEET_SSH_TARGET not set");
      } else if (!clis.ssh) {
        lines.push("  ✗ ssh client not installed");
      } else {
        const opts = config.ssh.options ? config.ssh.options.split(/\s+/).filter(Boolean) : [];
        const r = await runLocal(
          "ssh",
          [
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=5",
            ...opts,
            config.ssh.target,
            "echo fleet-mcp-ok",
          ],
          { timeoutMs: 8_000 }
        );
        lines.push(
          r.stdout.includes("fleet-mcp-ok")
            ? `  ✓ reachable: ${config.ssh.target}`
            : `  ✗ unreachable: ${config.ssh.target}\n${(r.stderr || "")
                .trim()
                .split("\n")
                .map((l) => "    " + l)
                .join("\n")}`
        );
      }

      return text(lines.join("\n"));
    })
  );
}
