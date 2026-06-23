import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runLocal, runRemote } from "../lib/exec.js";
import { text, errorText, fromExec, safe } from "../lib/result.js";
import { domainSchema, absolutePathSchema, shellQuote } from "../lib/validate.js";
import { READ_ONLY } from "../lib/annotations.js";

async function probe(url: string, fmt: string) {
  return runLocal("curl", ["-sS", "-o", "/dev/null", "-L", "-w", fmt, "--max-time", "20", url]);
}

export function registerSites(server: McpServer) {
  server.registerTool(
    "site_status",
    {
      title: "Site HTTP status",
      description:
        "Check one URL and return HTTP status code, total time, and the final URL after redirects.",
      inputSchema: { url: z.string().url().describe("Full URL including https://") },
      annotations: READ_ONLY,
    },
    safe(async ({ url }) => {
      const r = await probe(url, "%{http_code} %{time_total}s -> %{url_effective}");
      return r.code === 0
        ? text(`${url}\n${r.stdout.trim()}`)
        : errorText(r.stderr || `curl exit ${r.code}`);
    })
  );

  server.registerTool(
    "check_all_sites",
    {
      title: "Check many sites",
      description: "Check HTTP status for a list of URLs in parallel and return a summary table.",
      inputSchema: {
        urls: z.array(z.string().url()).min(1).max(100).describe("List of URLs"),
      },
      outputSchema: {
        results: z.array(
          z.object({
            url: z.string(),
            code: z.string().describe("HTTP status code, or 000 if unreachable"),
            timeSeconds: z.number(),
          })
        ),
      },
      annotations: READ_ONLY,
    },
    safe(async ({ urls }) => {
      const results = await Promise.all(
        urls.map(async (url) => {
          const r = await probe(url, "%{http_code} %{time_total}");
          const [code = "000", time = "0"] = r.stdout.trim().split(" ");
          return { url, code, timeSeconds: Number(time) || 0 };
        })
      );
      const rows = results.map(
        (r) => `${r.code.padEnd(4)} ${(r.timeSeconds + "s").padEnd(9)} ${r.url}`
      );
      return {
        ...text(["CODE TIME      URL", ...rows].join("\n")),
        structuredContent: { results },
      };
    })
  );

  server.registerTool(
    "ssl_expiry",
    {
      title: "SSL certificate expiry",
      description: "Return the TLS certificate expiry date and days remaining for a domain.",
      inputSchema: {
        domain: domainSchema.describe("Domain without protocol, e.g. example.com"),
        port: z.number().int().min(1).max(65_535).default(443).describe("TLS port"),
      },
      outputSchema: {
        domain: z.string(),
        expires: z.string().describe("Certificate notAfter date"),
        daysRemaining: z.number(),
      },
      annotations: READ_ONLY,
    },
    safe(async ({ domain, port }) => {
      // `domain` is validated to contain no shell metacharacters by domainSchema.
      const cmd = `echo | openssl s_client -servername ${domain} -connect ${domain}:${port} 2>/dev/null | openssl x509 -noout -enddate`;
      const r = await runLocal("bash", ["-lc", cmd]);
      if (r.code !== 0 || !r.stdout.includes("notAfter")) {
        return errorText(`Could not read certificate for ${domain}: ${r.stderr || r.stdout}`);
      }
      const dateStr = r.stdout.split("=")[1]?.trim() ?? "";
      const daysRemaining = Math.round((new Date(dateStr).getTime() - Date.now()) / 86_400_000);
      return {
        ...text(`${domain}\nExpires: ${dateStr}\nDays remaining: ${daysRemaining}`),
        structuredContent: { domain, expires: dateStr, daysRemaining },
      };
    })
  );

  server.registerTool(
    "disk_usage",
    {
      title: "Server disk usage",
      description: "Show server disk usage (df -h /) and the largest vhost directories.",
      inputSchema: {
        vhostsPath: absolutePathSchema
          .default("/var/www/vhosts")
          .describe("Base path of vhosts to measure"),
      },
      annotations: READ_ONLY,
    },
    safe(async ({ vhostsPath }) => {
      const cmd = `df -h /; echo '--- largest vhosts ---'; du -sh ${shellQuote(vhostsPath)}/*/ 2>/dev/null | sort -rh | head -n 20`;
      return fromExec(await runRemote(cmd));
    })
  );
}
