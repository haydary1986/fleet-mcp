import { describe, it, expect, beforeAll, vi } from "vitest";

// Mock the command layer so the integration test never touches SSH/network.
vi.mock("../src/lib/exec.js", () => {
  const ok = (stdout: string) => ({ stdout, stderr: "", code: 0 });
  const runLocal = vi.fn(async (file: string, args: string[] = []) => {
    if (file === "curl") return ok("200 0.05");
    if (file === "bash" && args.join(" ").includes("command -v")) {
      return ok(
        "ssh=1\ncurl=1\nopenssl=1\ngh=1\ndocker=0\nmysql=1\nmysqldump=1\nwget=1\npython3=1"
      );
    }
    return ok("mock-local-ok");
  });
  const runRemote = vi.fn(async () => ok("mock-remote-ok"));
  const runRemoteOn = vi.fn(async () => ok("mock-remote-ok"));
  return { runLocal, runRemote, runRemoteOn };
});

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/createServer.js";

let client: Client;

beforeAll(async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer();
  await server.connect(serverTransport);
  client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(clientTransport);
});

describe("tool registration", () => {
  it("registers the full fleet of tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("run_ssh");
    expect(names).toContain("fleet_doctor");
    expect(names).toContain("check_all_sites");
    expect(tools.length).toBeGreaterThanOrEqual(35);
  });

  it("annotates destructive vs read-only tools", async () => {
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(byName.run_ssh.annotations?.destructiveHint).toBe(true);
    expect(byName.site_status.annotations?.readOnlyHint).toBe(true);
    expect(byName.mysql_dump.annotations?.idempotentHint).toBe(true);
  });

  it("publishes an outputSchema for structured tools", async () => {
    const { tools } = await client.listTools();
    const checkAll = tools.find((t) => t.name === "check_all_sites");
    expect(checkAll?.outputSchema).toBeDefined();
  });
});

describe("tool behaviour", () => {
  it("blocks write SQL unless allowWrite is set", async () => {
    const res = await client.callTool({
      name: "mysql_query",
      arguments: { database: "appdb", sql: "DROP TABLE users" },
    });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain("Blocked");
  });

  it("returns structured content from check_all_sites", async () => {
    const res = await client.callTool({
      name: "check_all_sites",
      arguments: { urls: ["https://a.example", "https://b.example"] },
    });
    const structured = res.structuredContent as { results: Array<{ url: string; code: string }> };
    expect(structured.results).toHaveLength(2);
    expect(structured.results[0].code).toBe("200");
  });

  it("runs fleet_doctor and reports CLI + integration status", async () => {
    const res = await client.callTool({
      name: "fleet_doctor",
      arguments: { checkSsh: false },
    });
    const text = JSON.stringify(res.content);
    expect(text).toContain("Local CLIs");
    expect(text).toContain("Integrations");
  });
});

describe("resources", () => {
  it("lists the fleet resources", async () => {
    const { resources } = await client.listResources();
    const uris = resources.map((r) => r.uri);
    expect(uris).toContain("fleet://config");
    expect(uris).toContain("fleet://setup");
  });

  it("redacts secrets in fleet://config", async () => {
    const res = await client.readResource({ uri: "fleet://config" });
    const body = JSON.parse(res.contents[0].text as string);
    expect(body.name).toBe("fleet-mcp");
    expect(body.integrations).toBeDefined();
    // The serialized config must never leak a raw token value.
    expect(JSON.stringify(body)).not.toMatch(/tokenSet":\s*"/); // boolean, not a string secret
  });
});

describe("prompts", () => {
  it("lists the reusable prompts", async () => {
    const { prompts } = await client.listPrompts();
    const names = prompts.map((p) => p.name);
    expect(names).toContain("audit-site");
    expect(names).toContain("install-ojs-journal");
  });

  it("renders audit-site with the supplied domain", async () => {
    const res = await client.getPrompt({
      name: "audit-site",
      arguments: { domain: "example.com" },
    });
    const text = (res.messages[0].content as { text: string }).text;
    expect(text).toContain("example.com");
    expect(text).toContain("ssl_expiry");
  });
});
