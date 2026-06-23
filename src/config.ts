// Central configuration, loaded once from environment variables.
// Nothing is required at startup — each tool group validates its own settings
// lazily (via the require* helpers) so you can configure integrations one at a
// time without breaking the rest of the server. What IS validated here is the
// *format* of any value that has been provided, so misconfiguration fails fast
// with a clear message instead of surfacing as a confusing runtime error later.

export interface CloudflareAccount {
  key: string;
  token: string;
}

/** Parse CF_ACCOUNTS="main:token1,secondary:token2" into account records. */
export function parseCloudflareAccounts(raw: string | undefined): CloudflareAccount[] {
  if (!raw?.trim()) return [];
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

/** Read an integer env var, throwing a clear error if it is set but invalid. */
export function intEnv(
  name: string,
  fallback: number,
  bounds: { min?: number; max?: number } = {}
): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error(`${name} must be an integer (got "${raw}")`);
  }
  if (bounds.min !== undefined && n < bounds.min) {
    throw new Error(`${name} must be >= ${bounds.min} (got ${n})`);
  }
  if (bounds.max !== undefined && n > bounds.max) {
    throw new Error(`${name} must be <= ${bounds.max} (got ${n})`);
  }
  return n;
}

export const config = {
  ssh: {
    target: process.env.FLEET_SSH_TARGET ?? "",
    options: process.env.FLEET_SSH_OPTIONS ?? "",
  },
  wp: {
    docrootTemplate: process.env.WP_DOCROOT_TEMPLATE ?? "/var/www/vhosts/{domain}/httpdocs",
    phpBin: process.env.WP_CLI_PHP ?? "",
  },
  mysql: {
    user: process.env.MYSQL_USER ?? "",
    password: process.env.MYSQL_PASSWORD ?? "",
  },
  cloudflare: parseCloudflareAccounts(process.env.CF_ACCOUNTS),
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
  http: {
    port: intEnv("MCP_HTTP_PORT", 8787, { min: 1, max: 65_535 }),
    authToken: process.env.MCP_AUTH_TOKEN ?? "",
    rateLimitPerMinute: intEnv("MCP_RATE_LIMIT_PER_MINUTE", 120, { min: 1 }),
  },
  execTimeoutMs: intEnv("FLEET_EXEC_TIMEOUT_MS", 60_000, { min: 1_000 }),
} as const;

export function requireSsh(): string {
  if (!config.ssh.target) {
    throw new Error(
      "SSH not configured. Set FLEET_SSH_TARGET (e.g. root@host) in your environment."
    );
  }
  return config.ssh.target;
}
