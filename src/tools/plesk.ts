import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runRemote } from "../lib/exec.js";
import { fromExec, text, safe } from "../lib/result.js";
import { randomPassword } from "../lib/creds.js";

export function registerPlesk(server: McpServer) {
  server.registerTool(
    "plesk_list_domains",
    {
      title: "List Plesk domains",
      description: "List all domains/subdomains hosted in Plesk.",
      inputSchema: {},
    },
    safe(async () => fromExec(await runRemote("plesk bin domain --list")))
  );

  server.registerTool(
    "plesk_domain_info",
    {
      title: "Plesk domain info",
      description: "Show a domain's hosting info incl. document root and PHP handler.",
      inputSchema: { domain: z.string().describe("Domain or subdomain") },
    },
    safe(async ({ domain }) =>
      fromExec(
        await runRemote(
          `plesk bin domain --info ${domain} 2>&1 | grep -iE "name|root|hosting|php|ip address" || plesk bin subdomain --info ${domain}`
        )
      )
    )
  );

  server.registerTool(
    "plesk_create_subdomain",
    {
      title: "Create Plesk subdomain",
      description:
        "Create a subdomain under a parent subscription, optionally set its PHP handler, " +
        "and return the discovered document root (and 0750→755 fix for siteN docroots).",
      inputSchema: {
        label: z.string().describe("Subdomain label, e.g. ojs-demo"),
        parentDomain: z.string().describe("Parent subscription domain, e.g. example.com"),
        phpHandler: z
          .string()
          .optional()
          .describe("PHP handler id to set, e.g. plesk-php81-fastcgi"),
        chmod755: z.boolean().default(true).describe("chmod 755 the docroot (fixes siteN 404s)"),
      },
    },
    safe(async ({ label, parentDomain, phpHandler, chmod755 }) => {
      const fqdn = `${label}.${parentDomain}`;
      const handler = phpHandler
        ? `plesk bin subdomain --update ${label} -domain ${parentDomain} -php_handler_id ${phpHandler} 2>&1 | tail -1`
        : `echo "(no php handler change)"`;
      const cmd = `
plesk bin subdomain --create ${label} -domain ${parentDomain} 2>&1 | tail -2
DOCROOT=$(plesk bin subdomain --info ${fqdn} 2>/dev/null | grep -iE "root" | grep -oE "/var/www/vhosts/[^ ]+" | head -1)
${handler}
${chmod755 ? '[ -n "$DOCROOT" ] && chmod 755 "$DOCROOT"' : ""}
echo "docroot=$DOCROOT"
[ -n "$DOCROOT" ] && stat -c "owner=%U perms=%a" "$DOCROOT"`;
      return fromExec(await runRemote(cmd));
    })
  );

  server.registerTool(
    "plesk_set_php_handler",
    {
      title: "Set PHP handler",
      description:
        "Set the PHP handler for a domain or subdomain (tries `site` then `subdomain`).",
      inputSchema: {
        domain: z.string().describe("Domain or subdomain"),
        phpHandler: z.string().describe("Handler id, e.g. plesk-php82-fastcgi"),
      },
    },
    safe(async ({ domain, phpHandler }) =>
      fromExec(
        await runRemote(
          `plesk bin site --update "${domain}" -php_handler_id "${phpHandler}" 2>&1 | tail -1 ` +
            `|| plesk bin subdomain --update "$(echo ${domain} | cut -d. -f1)" -domain "$(echo ${domain} | cut -d. -f2-)" -php_handler_id "${phpHandler}" 2>&1 | tail -1`
        )
      )
    )
  );

  server.registerTool(
    "plesk_create_db",
    {
      title: "Create database + user",
      description:
        "Create a MySQL database and a user with full grants in Plesk, generating the " +
        "password if not given. Uses the required -server/-type flags. Returns credentials.",
      inputSchema: {
        database: z.string().describe("Database name"),
        domain: z.string().describe("Owning subscription domain (the PARENT for a subdomain)"),
        user: z.string().optional().describe("DB user (defaults to the database name)"),
        password: z.string().optional().describe("DB password (generated if omitted)"),
      },
    },
    safe(async ({ database, domain, user, password }) => {
      const dbUser = user ?? database;
      const dbPass = password ?? randomPassword(20);
      const cmd = `
plesk bin database --create "${database}" -domain "${domain}" -server localhost -type mysql 2>&1 | tail -1 || echo "(db may exist)"
plesk bin database --create-dbuser "${dbUser}" -passwd '${dbPass}' -domain "${domain}" -database "${database}" -server localhost -type mysql 2>&1 | tail -1`;
      const r = await runRemote(cmd);
      const creds = `\n\nDB:   ${database}\nUser: ${dbUser}\nPass: ${dbPass}\nHost: localhost`;
      return r.code === 0 ? text(`${r.stdout.trim()}${creds}`) : fromExec(r);
    })
  );

  server.registerTool(
    "plesk_issue_le",
    {
      title: "Issue Let's Encrypt cert",
      description:
        "Issue a Let's Encrypt certificate via the Plesk extension. The domain must resolve " +
        "to this origin for HTTP-01 (keep Cloudflare DNS-only/gray during issuance).",
      inputSchema: {
        domain: z.string().describe("Domain to secure"),
        email: z.string().email().describe("Registration email (required — bare call errors)"),
        includeWww: z.boolean().default(false).describe("Also include www.<domain> as a SAN"),
        webmail: z.boolean().default(false).describe("Also include webmail.<domain> as a SAN"),
      },
    },
    safe(async ({ domain, email, includeWww, webmail }) => {
      const sans = [
        `-d ${domain}`,
        includeWww ? `-d www.${domain}` : "",
        webmail ? `-d webmail.${domain}` : "",
      ]
        .filter(Boolean)
        .join(" ");
      return fromExec(
        await runRemote(
          `plesk bin extension --exec letsencrypt cli.php ${sans} -m ${email} 2>&1 | tail -8`
        )
      );
    })
  );
}
