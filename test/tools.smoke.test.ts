import { describe, it, expect, beforeAll, vi } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

// Mock the command layer: every tool that shells out gets a canned result.
vi.mock("../src/lib/exec.js", () => {
  const ok = (stdout: string) => ({ stdout, stderr: "", code: 0 });
  const runLocal = vi.fn(async (file: string, args: string[] = []) => {
    const joined = args.join(" ");
    if (file === "curl") return ok("200 0.05");
    if (file === "ssh") return ok("fleet-mcp-ok");
    if (file === "bash" && joined.includes("command -v")) {
      return ok(
        "ssh=1\ncurl=1\nopenssl=1\ngh=1\ndocker=1\nmysql=1\nmysqldump=1\nwget=1\npython3=1"
      );
    }
    if (file === "bash" && joined.includes("x509")) {
      return ok("notAfter=Dec 31 23:59:59 2030 GMT");
    }
    return ok("mock-ok");
  });
  return {
    runLocal,
    runRemote: vi.fn(async () => ok("mock-remote-ok")),
    runRemoteOn: vi.fn(async () => ok("mock-remote-ok")),
  };
});

// Mock the Cloudflare + Coolify HTTP APIs.
function mockResponse(url: string, init?: RequestInit) {
  const method = (init?.method ?? "GET").toUpperCase();
  const cfJson = (result: unknown) => ({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ success: true, result }),
    text: async () => "$ORIGIN example.com.\n@ 1 IN A 1.2.3.4\n",
  });
  if (url.includes("api.cloudflare.com")) {
    if (url.includes("/dns_records/export")) return cfJson(null);
    if (url.includes("/dns_records") && method === "POST")
      return cfJson({ type: "A", name: "www.example.com", content: "1.2.3.4", id: "rec1" });
    if (url.includes("/dns_records") && method === "PATCH")
      return cfJson({ name: "www.example.com", proxied: true });
    if (url.includes("/dns_records"))
      return cfJson([
        { type: "A", name: "www.example.com", content: "1.2.3.4", proxied: true, id: "rec1" },
      ]);
    if (url.includes("/zones"))
      return cfJson([
        {
          id: "zone1",
          name: "example.com",
          status: "active",
          plan: { name: "Free" },
          name_servers: ["a.ns", "b.ns"],
        },
      ]);
    return cfJson([]);
  }
  // Coolify: client reads res.text() then JSON.parses it.
  const coolifyBody = url.includes("/servers")
    ? '[{"name":"srv1","ip":"1.2.3.4","is_reachable":true}]'
    : url.includes("/applications")
      ? '[{"name":"app1","status":"running:healthy","uuid":"u1"}]'
      : url.includes("/deploy")
        ? '{"message":"queued"}'
        : "[]";
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => JSON.parse(coolifyBody),
    text: async () => coolifyBody,
  };
}

let client: Client;

beforeAll(async () => {
  vi.stubEnv("CF_ACCOUNTS", "main:test-token");
  vi.stubEnv("COOLIFY_BASE_URL", "https://coolify.test");
  vi.stubEnv("COOLIFY_TOKEN", "test-token");
  vi.stubEnv("FLEET_SSH_TARGET", "root@fleet.test");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => mockResponse(url, init))
  );

  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { createServer } = await import("../src/createServer.js");

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer();
  await server.connect(serverTransport);
  client = new Client({ name: "smoke", version: "1.0.0" });
  await client.connect(clientTransport);
});

// Each entry exercises one tool's handler end-to-end.
const CALLS: Array<{ name: string; args: Record<string, unknown> }> = [
  { name: "run_ssh", args: { command: "uptime" } },
  { name: "site_status", args: { url: "https://example.com" } },
  { name: "ssl_expiry", args: { domain: "example.com" } },
  { name: "disk_usage", args: {} },
  { name: "wp", args: { site: "example.com", command: "plugin list" } },
  { name: "wp_update_plugins", args: { site: "example.com", dryRun: true } },
  { name: "wp_purge_lscache", args: { site: "example.com" } },
  { name: "wp_health", args: { site: "example.com" } },
  { name: "wp_php_handler", args: { domain: "example.com" } },
  { name: "cf_zone_status", args: { domain: "example.com" } },
  { name: "cf_dns_list", args: { domain: "example.com" } },
  {
    name: "cf_dns_add",
    args: { domain: "example.com", type: "A", name: "www", content: "1.2.3.4" },
  },
  {
    name: "cf_toggle_proxy",
    args: { domain: "example.com", name: "www.example.com", proxied: true },
  },
  { name: "cf_export_records", args: { domain: "example.com" } },
  { name: "mysql_query", args: { database: "appdb", sql: "SELECT 1" } },
  { name: "mysql_table_sizes", args: { database: "appdb" } },
  {
    name: "mysql_create_user",
    args: { database: "appdb", user: "appuser", password: "p@ss'word" },
  },
  { name: "mysql_dump", args: { database: "appdb" } },
  { name: "gh", args: { args: ["repo", "view"] } },
  { name: "gh_pr_list", args: { repo: "owner/name" } },
  { name: "gh_create_issue", args: { repo: "owner/name", title: "bug" } },
  { name: "docker_ps", args: { all: true } },
  { name: "docker_logs", args: { container: "web_1" } },
  { name: "docker_restart", args: { container: "web_1" } },
  { name: "docker_raw", args: { args: ["version"] } },
  { name: "coolify_servers", args: {} },
  { name: "coolify_apps", args: {} },
  { name: "coolify_deploy", args: { uuid: "u1" } },
  { name: "coolify_resources", args: {} },
  { name: "ojs_status", args: { domain: "journal.example.com" } },
  {
    name: "ojs_create_journal",
    args: { domain: "journal.example.com", urlPath: "j", nameEn: "J", acronym: "J" },
  },
  { name: "ojs_install", args: { domain: "journal.example.com", adminEmail: "a@b.com" } },
  { name: "dev_check", args: { path: "/srv/app", install: false } },
  { name: "scaffold_go", args: { name: "app", module: "github.com/me/app", dir: "/srv" } },
  { name: "scaffold_ts_lib", args: { name: "lib", dir: "/srv" } },
  { name: "dockerize", args: { path: "/srv/app", stack: "node" } },
  { name: "fleet_doctor", args: { checkSsh: true } },
];

describe("every tool handler runs end-to-end", () => {
  it.each(CALLS)("$name returns a non-error result", async ({ name, args }) => {
    const res = await client.callTool({ name, arguments: args });
    expect(res).toBeDefined();
    expect(res.isError, `${name} returned an error: ${JSON.stringify(res.content)}`).toBeFalsy();
    expect(Array.isArray(res.content)).toBe(true);
  });
});
