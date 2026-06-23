import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config } from "../config.js";
import { runRemote } from "../lib/exec.js";
import { fromExec, safe } from "../lib/result.js";

/** Build a remote script that runs a Moodle CLI command as the site's web user.
 *  Running as root would write cache/moodledata files root-owned and break the
 *  next web request, so we drop to the docroot owner via runuser. */
function moodleScript(site: string, docroot: string | undefined, cliCmd: string): string {
  const fallback = config.moodle.docrootTemplate.replace("{domain}", site);
  const docrootAssign = docroot
    ? `DOCROOT="${docroot}"`
    : `DOCROOT=$(plesk bin subdomain --info ${site} 2>/dev/null | grep -iE "root" | grep -oE "/var/www/vhosts/[^ ]+" | head -1); [ -z "$DOCROOT" ] && DOCROOT="${fallback}"`;
  return `${docrootAssign}
[ -d "$DOCROOT" ] || { echo "ERROR: docroot $DOCROOT not found"; exit 2; }
WEBUSER=$(stat -c '%U' "$DOCROOT")
cd "$DOCROOT"
runuser -u "$WEBUSER" -- ${config.moodle.phpBin} ${cliCmd} 2>&1`;
}

const siteArg = z.string().describe("Moodle domain, e.g. lms.example.com");
const docrootArg = z.string().optional().describe("Override docroot (else discovered; siteN-aware)");

export function registerMoodle(server: McpServer) {
  server.registerTool(
    "moodle_cron",
    {
      title: "Run Moodle cron",
      description: "Run the Moodle cron CLI (admin/cli/cron.php) as the web user.",
      inputSchema: { site: siteArg, docroot: docrootArg },
    },
    safe(async ({ site, docroot }) =>
      fromExec(await runRemote(moodleScript(site, docroot, "admin/cli/cron.php"), { timeoutMs: 300_000 }))
    )
  );

  server.registerTool(
    "moodle_purge_caches",
    {
      title: "Purge Moodle caches",
      description: "Purge all Moodle caches (admin/cli/purge_caches.php).",
      inputSchema: { site: siteArg, docroot: docrootArg },
    },
    safe(async ({ site, docroot }) =>
      fromExec(await runRemote(moodleScript(site, docroot, "admin/cli/purge_caches.php")))
    )
  );

  server.registerTool(
    "moodle_maintenance",
    {
      title: "Moodle maintenance mode",
      description: "Enable or disable Moodle maintenance mode (admin/cli/maintenance.php).",
      inputSchema: {
        site: siteArg,
        enable: z.boolean().describe("true = enable, false = disable"),
        docroot: docrootArg,
      },
    },
    safe(async ({ site, enable, docroot }) =>
      fromExec(
        await runRemote(
          moodleScript(site, docroot, `admin/cli/maintenance.php ${enable ? "--enable" : "--disable"}`)
        )
      )
    )
  );

  server.registerTool(
    "moodle_upgrade",
    {
      title: "Upgrade Moodle",
      description: "Run the Moodle upgrade CLI non-interactively (after a code update).",
      inputSchema: { site: siteArg, docroot: docrootArg },
    },
    safe(async ({ site, docroot }) =>
      fromExec(
        await runRemote(moodleScript(site, docroot, "admin/cli/upgrade.php --non-interactive"), {
          timeoutMs: 600_000,
        })
      )
    )
  );

  server.registerTool(
    "moodle_cli",
    {
      title: "Run a Moodle CLI script",
      description:
        'Run any admin/cli script, e.g. cli="admin/cli/cfg.php --name=maintenance_enabled". ' +
        "Runs as the web user from the docroot.",
      inputSchema: {
        site: siteArg,
        cli: z.string().describe("CLI path + args relative to docroot, e.g. admin/cli/cfg.php --list"),
        docroot: docrootArg,
      },
    },
    safe(async ({ site, cli, docroot }) =>
      fromExec(await runRemote(moodleScript(site, docroot, cli), { timeoutMs: 600_000 }))
    )
  );
}
