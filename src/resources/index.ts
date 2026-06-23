import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config } from "../config.js";
import { NAME, VERSION } from "../lib/version.js";

const here = dirname(fileURLToPath(import.meta.url));

/** Read a project-root file (works from dist/ and from src/ via tsx). */
function readRootFile(name: string): string {
  for (const rel of ["../../", "../"]) {
    try {
      return readFileSync(join(here, rel, name), "utf8");
    } catch {
      // try next candidate
    }
  }
  throw new Error(`${name} not found`);
}

/** A redacted snapshot of what is configured — never includes secret values. */
function configStatus() {
  const cf = config.cloudflare;
  return {
    name: NAME,
    version: VERSION,
    integrations: {
      ssh: { configured: !!config.ssh.target, target: config.ssh.target || null },
      cloudflare: { configured: cf.length > 0, accounts: cf.map((a) => a.key) },
      coolify: {
        configured: !!(config.coolify.baseUrl && config.coolify.token),
        baseUrl: config.coolify.baseUrl || null,
      },
      docker: {
        mode: config.docker.sshTarget ? "ssh" : "local",
        target: config.docker.sshTarget || null,
      },
      github: { tokenSet: !!config.github.token },
      mysql: { user: config.mysql.user || null, passwordSet: !!config.mysql.password },
      ojs: { phpBin: config.ojs.phpBin, version: config.ojs.version },
    },
    httpTransport: {
      port: config.http.port,
      authConfigured: !!config.http.authToken,
      rateLimitPerMinute: config.http.rateLimitPerMinute,
    },
  };
}

export function registerResources(server: McpServer) {
  server.registerResource(
    "fleet-config",
    "fleet://config",
    {
      title: "Fleet configuration status",
      description:
        "Which integrations are configured for this server (redacted — no secrets). " +
        "Read this to learn what the server can currently do.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(configStatus(), null, 2),
        },
      ],
    })
  );

  server.registerResource(
    "fleet-setup",
    "fleet://setup",
    {
      title: "Configuration template (.env.example)",
      description: "The annotated .env.example showing every supported setting.",
      mimeType: "text/plain",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/plain", text: readRootFile(".env.example") }],
    })
  );
}
