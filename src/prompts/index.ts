import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/** Reusable, parameterised prompts the client can surface to the user. */
export function registerPrompts(server: McpServer) {
  server.registerPrompt(
    "audit-site",
    {
      title: "Audit a site",
      description:
        "Run a health audit of a single site: HTTP status, SSL expiry, WordPress " +
        "health, and Cloudflare DNS/proxy posture.",
      argsSchema: {
        domain: z.string().describe("Domain to audit, e.g. example.com"),
      },
    },
    ({ domain }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Audit the site ${domain}. Do all of the following and summarise findings with any red flags first:\n` +
              `1. Use site_status on https://${domain} to confirm it responds (note redirects).\n` +
              `2. Use ssl_expiry for ${domain} — flag if fewer than 21 days remain.\n` +
              `3. Use wp_health for ${domain} (skip if it is not a WordPress site).\n` +
              `4. Use cf_dns_list for ${domain} and note which records are proxied vs DNS-only.\n` +
              `End with a short prioritised list of recommended actions.`,
          },
        },
      ],
    })
  );

  server.registerPrompt(
    "install-ojs-journal",
    {
      title: "Install an OJS journal",
      description:
        "Provision a fresh OJS install on an existing Plesk subdomain and create the " +
        "first journal in one pass.",
      argsSchema: {
        domain: z.string().describe("Subdomain, e.g. journal.example.com"),
        nameEn: z.string().describe("English journal name"),
        nameAr: z.string().describe("Arabic journal name (optional — pass empty to skip)"),
        acronym: z.string().describe("Journal acronym, e.g. NJ"),
      },
    },
    ({ domain, nameEn, nameAr, acronym }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Install OJS on ${domain} and create the first journal in the same run.\n` +
              `First confirm prerequisites with fleet_doctor and ojs_status (the Plesk ` +
              `subdomain, docroot and DNS must already exist — use cf_dns_add if a DNS ` +
              `record is missing).\n` +
              `Then call ojs_install with createJournal=true, journalNameEn="${nameEn}", ` +
              (nameAr ? `journalNameAr="${nameAr}", ` : "") +
              `acronym="${acronym}".\n` +
              `Finally run ojs_status and report the homepage + journal HTTP codes and the ` +
              `generated admin/DB credentials so I can save them.`,
          },
        },
      ],
    })
  );
}
