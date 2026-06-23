// Central configuration, loaded once from environment variables.
// Nothing is required at startup — each tool group validates its own settings
// lazily (via the require* helpers) so you can configure integrations one at a
// time without breaking the rest of the server.

export interface CloudflareAccount {
  key: string;
  token: string;
}

export function parseCloudflareAccounts(
  raw = process.env.CF_ACCOUNTS?.trim()
): CloudflareAccount[] {
  // CF_ACCOUNTS = "main:token1,secondary:token2"
  if (!raw) return [];
  return raw
    .split(",")
    .map((pair) => {
      const idx = pair.indexOf(":");
      if (idx === -1) return null;
      const key = pair.slice(0, idx).trim();
      const token = pair.slice(idx + 1).trim();
      return key && token ? { key, token } : null;
    })
    .filter((a): a is CloudflareAccount => a !== null);
}

export const config = {
  ssh: {
    target: process.env.FLEET_SSH_TARGET ?? "",
    options: process.env.FLEET_SSH_OPTIONS ?? "",
    // Reuse one SSH connection across tool calls (ControlMaster) — faster and
    // avoids fail2ban bans from many rapid connections. Disable with "false".
    multiplex: (process.env.FLEET_SSH_MULTIPLEX ?? "true").toLowerCase() !== "false",
    controlPath: process.env.FLEET_SSH_CONTROL_PATH ?? "/tmp/fleet-mcp-cm-%r@%h:%p",
    controlPersist: process.env.FLEET_SSH_CONTROL_PERSIST ?? "120s",
  },
  wp: {
    docrootTemplate:
      process.env.WP_DOCROOT_TEMPLATE ?? "/var/www/vhosts/{domain}/httpdocs",
    phpBin: process.env.WP_CLI_PHP ?? "",
  },
  mysql: {
    user: process.env.MYSQL_USER ?? "",
    password: process.env.MYSQL_PASSWORD ?? "",
  },
  cloudflare: parseCloudflareAccounts(),
  github: {
    token: process.env.GITHUB_TOKEN ?? "",
  },
  docker: {
    sshTarget: process.env.DOCKER_SSH_TARGET ?? "",
  },
  coolify: {
    baseUrl: (process.env.COOLIFY_BASE_URL ?? "").replace(/\/+$/, ""),
    token: process.env.COOLIFY_TOKEN ?? "",
  },
  ojs: {
    phpBin: process.env.OJS_PHP_BIN ?? "/opt/plesk/php/8.1/bin/php",
    phpHandler: process.env.OJS_PHP_HANDLER ?? "plesk-php81-fastcgi",
    version: process.env.OJS_VERSION ?? "3.4.0-9",
    downloadBase: process.env.OJS_DOWNLOAD_BASE ?? "https://pkp.sfu.ca/ojs/download",
    adminEmail: process.env.OJS_ADMIN_EMAIL ?? "",
    vhostsRoot: process.env.OJS_VHOSTS_ROOT ?? "/var/www/vhosts",
  },
  moodle: {
    phpBin: process.env.MOODLE_PHP_BIN ?? "/opt/plesk/php/8.2/bin/php",
    docrootTemplate:
      process.env.MOODLE_DOCROOT_TEMPLATE ?? "/var/www/vhosts/{domain}/httpdocs",
  },
  http: {
    port: Number(process.env.MCP_HTTP_PORT ?? 8787),
    authToken: process.env.MCP_AUTH_TOKEN ?? "",
  },
  execTimeoutMs: Number(process.env.FLEET_EXEC_TIMEOUT_MS ?? 60_000),
} as const;

export function requireSsh(): string {
  if (!config.ssh.target) {
    throw new Error(
      "SSH not configured. Set FLEET_SSH_TARGET (e.g. root@host) in your environment."
    );
  }
  return config.ssh.target;
}
