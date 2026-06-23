import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config } from "../config.js";
import { runRemote } from "../lib/exec.js";
import { fromExec, safe } from "../lib/result.js";

/** Resolve a site reference to a docroot path. */
function docrootFor(siteOrPath: string): string {
  if (siteOrPath.startsWith("/")) return siteOrPath;
  return config.wp.docrootTemplate.replace("{domain}", siteOrPath);
}

/** wp-cli invocation, optionally pinned to a specific PHP binary. */
function wpBin(): string {
  return config.wp.phpBin ? `${config.wp.phpBin} $(command -v wp)` : "wp";
}

function wpRun(site: string, wpArgs: string) {
  const path = docrootFor(site);
  return runRemote(`cd ${path} && ${wpBin()} ${wpArgs}`);
}

const siteArg = z.string().describe("Domain (example.com) or absolute docroot path");

export function registerWordpress(server: McpServer) {
  server.registerTool(
    "wp",
    {
      title: "Run wp-cli",
      description:
        "Run an arbitrary wp-cli command for a site over SSH. `site` is a domain " +
        "(mapped via WP_DOCROOT_TEMPLATE) or an absolute docroot path.",
      inputSchema: {
        site: siteArg,
        command: z
          .string()
          .describe("wp-cli arguments, e.g. \"plugin list --status=active\""),
      },
    },
    safe(async ({ site, command }) => fromExec(await wpRun(site, command)))
  );

  server.registerTool(
    "wp_update_plugins",
    {
      title: "Update WordPress plugins",
      description: "Update all plugins for a site (wp plugin update --all).",
      inputSchema: {
        site: siteArg,
        dryRun: z.boolean().default(false).describe("Only report available updates"),
      },
    },
    safe(async ({ site, dryRun }) =>
      fromExec(await wpRun(site, `plugin update --all${dryRun ? " --dry-run" : ""}`))
    )
  );

  server.registerTool(
    "wp_purge_lscache",
    {
      title: "Purge LiteSpeed cache",
      description:
        "Purge the full LiteSpeed (LSCache) cache for a site. Note: restarting " +
        "lsws is NOT the same as purging the cache.",
      inputSchema: { site: siteArg },
    },
    safe(async ({ site }) => fromExec(await wpRun(site, "litespeed-purge all")))
  );

  server.registerTool(
    "wp_health",
    {
      title: "WordPress health check",
      description:
        "Quick health snapshot: site URL, core version, active plugin count, " +
        "and PHP version reported by wp-cli.",
      inputSchema: { site: siteArg },
    },
    safe(async ({ site }) => {
      const cmd =
        "option get siteurl; core version; plugin list --status=active --format=count; " +
        "eval 'echo PHP_VERSION;'";
      return fromExec(await wpRun(site, cmd));
    })
  );

  server.registerTool(
    "wp_php_handler",
    {
      title: "Show Plesk PHP handler",
      description:
        "Show the PHP handler configured in Plesk for a domain (FastCGI vs FPM, version).",
      inputSchema: {
        domain: z.string().describe("Domain registered in Plesk, e.g. example.com"),
      },
    },
    safe(async ({ domain }) =>
      fromExec(
        await runRemote(`plesk bin domain --info ${domain} 2>&1 | grep -iE 'php' || echo 'no php info'`)
      )
    )
  );

  server.registerTool(
    "wp_search_replace",
    {
      title: "Search-replace (migrations)",
      description:
        "Run wp search-replace across all tables — the standard URL/domain rewrite for " +
        "migrations. Defaults to a dry run; set dryRun=false to apply.",
      inputSchema: {
        site: siteArg,
        from: z.string().describe("Old string, e.g. http://old.example.com"),
        to: z.string().describe("New string, e.g. https://new.example.com"),
        dryRun: z.boolean().default(true).describe("Preview changes without writing"),
      },
    },
    safe(async ({ site, from, to, dryRun }) =>
      fromExec(
        await wpRun(
          site,
          `search-replace '${from}' '${to}' --all-tables --report-changes-only${dryRun ? " --dry-run" : ""}`
        )
      )
    )
  );

  server.registerTool(
    "wp_integrity",
    {
      title: "Integrity / malware check",
      description:
        "Verify WordPress core and plugin files against official checksums to detect tampering " +
        "or injected malware (wp core/plugin verify-checksums).",
      inputSchema: { site: siteArg },
    },
    safe(async ({ site }) => {
      const path = docrootFor(site);
      const cmd = `cd ${path} && echo '== core ==' && ${wpBin()} core verify-checksums 2>&1; echo '== plugins ==' && ${wpBin()} plugin verify-checksums --all 2>&1`;
      return fromExec(await runRemote(cmd));
    })
  );

  server.registerTool(
    "wp_core_update",
    {
      title: "Update WordPress core",
      description: "Update WordPress core and run the database upgrade (wp core update + update-db).",
      inputSchema: {
        site: siteArg,
        dryRun: z.boolean().default(false).describe("Only check for an available update"),
      },
    },
    safe(async ({ site, dryRun }) => {
      if (dryRun) return fromExec(await wpRun(site, "core check-update"));
      const path = docrootFor(site);
      const cmd = `cd ${path} && ${wpBin()} core update 2>&1 && ${wpBin()} core update-db 2>&1`;
      return fromExec(await runRemote(cmd));
    })
  );

  server.registerTool(
    "wp_maintenance",
    {
      title: "Maintenance mode",
      description: "Enable or disable WordPress maintenance mode.",
      inputSchema: {
        site: siteArg,
        enable: z.boolean().describe("true = activate, false = deactivate"),
      },
    },
    safe(async ({ site, enable }) =>
      fromExec(await wpRun(site, `maintenance-mode ${enable ? "activate" : "deactivate"}`))
    )
  );

  server.registerTool(
    "wp_backup",
    {
      title: "Backup WordPress",
      description:
        "Back up a site's database (gzip) and optionally its wp-content, to a timestamped file " +
        "on the server. Returns the backup paths.",
      inputSchema: {
        site: siteArg,
        dir: z.string().default("/root/backups").describe("Destination directory on the server"),
        includeFiles: z.boolean().default(false).describe("Also tar wp-content"),
      },
    },
    safe(async ({ site, dir, includeFiles }) => {
      const path = docrootFor(site);
      const label = site.replace(/[^a-z0-9]/gi, "_");
      const files = includeFiles
        ? `tar czf ${dir}/${label}-files-$TS.tgz -C ${path} wp-content && `
        : "";
      const cmd = `mkdir -p ${dir} && cd ${path} && TS=$(date +%F-%H%M%S) && ${wpBin()} db export ${dir}/${label}-$TS.sql 2>&1 && gzip -f ${dir}/${label}-$TS.sql && ${files}ls -lh ${dir}/${label}-*$TS*`;
      return fromExec(await runRemote(cmd));
    })
  );
}
