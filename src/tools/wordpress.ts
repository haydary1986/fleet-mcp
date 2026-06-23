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
}
