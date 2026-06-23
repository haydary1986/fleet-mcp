import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cf, cfText, cfImportBind, zoneId } from "../lib/cloudflare.js";
import { text, json, safe } from "../lib/result.js";

const accountArg = z
  .string()
  .optional()
  .describe("Cloudflare account key from CF_ACCOUNTS (defaults to the first)");

export function registerCloudflare(server: McpServer) {
  server.registerTool(
    "cf_zone_status",
    {
      title: "Cloudflare zone status",
      description: "Show a zone's status, plan, and nameservers by domain name.",
      inputSchema: { domain: z.string().describe("Domain, e.g. example.org"), account: accountArg },
    },
    safe(async ({ domain, account }) => {
      const j = await cf(account, `/zones?name=${encodeURIComponent(domain)}`);
      const z0 = j.result?.[0];
      if (!z0) return text(`No zone found for ${domain}`);
      return text(
        `${z0.name}\nstatus: ${z0.status}\nplan: ${z0.plan?.name}\nNS: ${(z0.name_servers ?? []).join(", ")}`
      );
    })
  );

  server.registerTool(
    "cf_dns_list",
    {
      title: "List DNS records",
      description: "List DNS records for a zone (by domain).",
      inputSchema: {
        domain: z.string().describe("Zone domain"),
        type: z.string().optional().describe("Filter by record type, e.g. A, CNAME, MX"),
        account: accountArg,
      },
    },
    safe(async ({ domain, type, account }) => {
      const id = await zoneId(account, domain);
      const q = type ? `?type=${encodeURIComponent(type)}&per_page=200` : "?per_page=200";
      const j = await cf(account, `/zones/${id}/dns_records${q}`);
      const rows = (j.result ?? []).map(
        (r: any) =>
          `${r.type.padEnd(6)} ${r.name.padEnd(32)} ${String(r.content).padEnd(28)} ${r.proxied ? "proxied" : "dns-only"}`
      );
      return text(rows.length ? rows.join("\n") : "(no records)");
    })
  );

  server.registerTool(
    "cf_dns_add",
    {
      title: "Add DNS record",
      description: "Create a DNS record in a zone.",
      inputSchema: {
        domain: z.string().describe("Zone domain"),
        type: z.string().describe("Record type, e.g. A, AAAA, CNAME, TXT, MX"),
        name: z.string().describe("Record name, e.g. www or @ for root"),
        content: z.string().describe("Record value, e.g. an IP or target host"),
        proxied: z.boolean().default(false).describe("Proxy through Cloudflare (orange cloud)"),
        ttl: z.number().int().default(1).describe("TTL in seconds (1 = automatic)"),
        priority: z.number().int().optional().describe("Priority (MX/SRV only)"),
        account: accountArg,
      },
    },
    safe(async ({ domain, type, name, content, proxied, ttl, priority, account }) => {
      const id = await zoneId(account, domain);
      const body: Record<string, unknown> = { type, name, content, proxied, ttl };
      if (priority !== undefined) body.priority = priority;
      const j = await cf(account, `/zones/${id}/dns_records`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return text(`Created ${j.result.type} ${j.result.name} -> ${j.result.content} (id ${j.result.id})`);
    })
  );

  server.registerTool(
    "cf_toggle_proxy",
    {
      title: "Toggle record proxy",
      description: "Turn Cloudflare proxy (orange cloud) on or off for a specific record.",
      inputSchema: {
        domain: z.string().describe("Zone domain"),
        name: z.string().describe("Full record name, e.g. www.example.com"),
        proxied: z.boolean().describe("true = proxied (orange), false = DNS only (grey)"),
        account: accountArg,
      },
    },
    safe(async ({ domain, name, proxied, account }) => {
      const id = await zoneId(account, domain);
      const list = await cf(account, `/zones/${id}/dns_records?name=${encodeURIComponent(name)}`);
      const rec = list.result?.[0];
      if (!rec) return text(`Record not found: ${name}`);
      const j = await cf(account, `/zones/${id}/dns_records/${rec.id}`, {
        method: "PATCH",
        body: JSON.stringify({ proxied }),
      });
      return text(`${j.result.name} is now ${j.result.proxied ? "proxied" : "DNS only"}`);
    })
  );

  server.registerTool(
    "cf_export_records",
    {
      title: "Export DNS (BIND)",
      description: "Export all DNS records for a zone as a BIND zone file (good for backups).",
      inputSchema: { domain: z.string().describe("Zone domain"), account: accountArg },
    },
    safe(async ({ domain, account }) => {
      const id = await zoneId(account, domain);
      return text(await cfText(account, `/zones/${id}/dns_records/export`));
    })
  );

  server.registerTool(
    "cf_zone_restore",
    {
      title: "Restore DNS from BIND",
      description:
        "Import a BIND zone file into a zone — restores records after an accidental zone " +
        "deletion or purge. Pass the BIND text from a prior cf_export_records backup.",
      inputSchema: {
        domain: z.string().describe("Zone domain"),
        bind: z.string().describe("BIND zone file contents to import"),
        proxied: z
          .boolean()
          .optional()
          .describe("Override proxy status for imported records (omit to keep file's)"),
        account: accountArg,
      },
    },
    safe(async ({ domain, bind, proxied, account }) => {
      const id = await zoneId(account, domain);
      const res = await cfImportBind(account, id, bind, proxied);
      const total = res.result?.total_records_parsed ?? res.result?.recs_added;
      return text(`Imported into ${domain}. ${JSON.stringify(res.result ?? res)}\n(records parsed: ${total})`);
    })
  );

  server.registerTool(
    "cf_purge_cache",
    {
      title: "Purge Cloudflare cache",
      description:
        "Purge a zone's Cloudflare cache — everything, or only specific URLs. Note: this is " +
        "the CF edge cache, separate from origin LiteSpeed LSCache.",
      inputSchema: {
        domain: z.string().describe("Zone domain"),
        files: z
          .array(z.string().url())
          .optional()
          .describe("Specific URLs to purge (omit to purge everything)"),
        account: accountArg,
      },
    },
    safe(async ({ domain, files, account }) => {
      const id = await zoneId(account, domain);
      const body = files?.length ? { files } : { purge_everything: true };
      const res = await cf(account, `/zones/${id}/purge_cache`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return res.success
        ? text(files?.length ? `Purged ${files.length} URL(s) for ${domain}` : `Purged everything for ${domain}`)
        : json(res);
    })
  );
}
