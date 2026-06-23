import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config } from "../config.js";
import { runRemote } from "../lib/exec.js";
import { fromExec, text, errorText, safe } from "../lib/result.js";
import { randomPassword, subLabel } from "../lib/creds.js";
import { buildInstallScript, buildJournalScript } from "../lib/ojs-scripts.js";
import { domainSchema, absolutePathSchema, shellQuote } from "../lib/validate.js";
import { READ_ONLY, WRITE, DESTRUCTIVE } from "../lib/annotations.js";

const INSTALL_TIMEOUT_MS = 300_000; // downloads + install can take minutes

export function registerOjs(server: McpServer) {
  server.registerTool(
    "ojs_install",
    {
      title: "Install OJS journal",
      description:
        "Provision a fresh OJS install on an EXISTING Plesk subdomain/webspace: deploy " +
        "files, create DB + user, run the CLI installer, patch config.inc.php " +
        "(allowed_hosts/base_url/trust_x_forwarded_for), set perms and PHP handler. " +
        "Generates admin + DB passwords and returns the access details. " +
        "Prerequisite: the subdomain, its docroot and DNS must already exist.",
      annotations: DESTRUCTIVE,
      inputSchema: {
        domain: domainSchema.describe("Full subdomain, e.g. journal.example.com"),
        adminEmail: z
          .string()
          .email()
          .optional()
          .describe("Admin email (defaults to OJS_ADMIN_EMAIL)"),
        docroot: absolutePathSchema.optional().describe("Override docroot path"),
        filesDir: absolutePathSchema
          .optional()
          .describe("Override OJS files dir (outside webroot)"),
        primaryLocale: z.string().default("en").describe("Primary locale key"),
        additionalLocales: z.string().default("ar").describe("Comma-separated extra locale keys"),
        setPhpHandler: z
          .boolean()
          .default(true)
          .describe("Set the Plesk PHP handler to OJS_PHP_HANDLER (php81 fastcgi)"),
        createJournal: z
          .boolean()
          .default(false)
          .describe("Also create the first journal after install (see ojs_create_journal args)"),
        journalPath: z
          .string()
          .optional()
          .describe("urlPath for the journal when createJournal=true"),
        journalNameEn: z
          .string()
          .optional()
          .describe("English journal name when createJournal=true"),
        journalNameAr: z
          .string()
          .optional()
          .describe("Arabic journal name when createJournal=true"),
        acronym: z.string().optional().describe("Journal acronym when createJournal=true"),
      },
    },
    safe(async (a) => {
      const adminEmail = a.adminEmail ?? config.ojs.adminEmail;
      if (!adminEmail) {
        return errorText("No admin email. Pass adminEmail or set OJS_ADMIN_EMAIL.");
      }
      const label = subLabel(a.domain);
      const docroot = a.docroot ?? `${config.ojs.vhostsRoot}/${a.domain}/httpdocs`;
      const filesDir = a.filesDir ?? `${config.ojs.vhostsRoot}/${a.domain}/ojs-files`;
      const adminUser = "admin";
      const adminPass = randomPassword(18);
      const dbName = `${label}_ojs`;
      const dbUser = `${label}_ojs`;
      const dbPass = randomPassword(20);

      const script = buildInstallScript({
        domain: a.domain,
        docroot,
        filesDir,
        dbName,
        dbUser,
        dbPass,
        adminUser,
        adminPass,
        adminEmail,
        primaryLocale: a.primaryLocale,
        additionalLocales: a.additionalLocales,
        oaiRepoId: `${label}.ojs`,
        phpBin: config.ojs.phpBin,
        version: config.ojs.version,
        downloadBase: config.ojs.downloadBase,
        phpHandler: config.ojs.phpHandler,
        setPhpHandler: a.setPhpHandler,
      });

      const installLog = await runRemote(script, { timeoutMs: INSTALL_TIMEOUT_MS });

      let journalLog = "";
      if (a.createJournal) {
        const urlPath = a.journalPath ?? label;
        const nameEn = a.journalNameEn ?? a.domain;
        const journalScript = buildJournalScript({
          domain: a.domain,
          docroot,
          urlPath,
          primaryLocale: a.primaryLocale,
          locales: [
            a.primaryLocale,
            ...a.additionalLocales
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          ],
          nameByLocale: { en: nameEn, ...(a.journalNameAr ? { ar: a.journalNameAr } : {}) },
          acronymByLocale: { en: a.acronym ?? label.toUpperCase() },
          phpBin: config.ojs.phpBin,
        });
        const r = await runRemote(journalScript, { timeoutMs: INSTALL_TIMEOUT_MS });
        journalLog = `\n\n=== JOURNAL CREATION ===\n${r.stdout}\n${r.stderr}`;
      }

      const creds =
        `\n\n=== ACCESS DETAILS (save these) ===\n` +
        `URL:           https://${a.domain}/\n` +
        `Admin login:   ${adminUser}\n` +
        `Admin pass:    ${adminPass}\n` +
        `Admin email:   ${adminEmail}\n` +
        `DB name/user:  ${dbName} / ${dbUser}\n` +
        `DB password:   ${dbPass}\n` +
        `Files dir:     ${filesDir}\n` +
        (a.createJournal
          ? `Journal URL:   https://${a.domain}/index.php/${a.journalPath ?? label}/\n`
          : "");

      const body = `${installLog.stdout}\n${installLog.stderr}${journalLog}${creds}`;
      return installLog.code === 0 ? text(body) : errorText(body);
    })
  );

  server.registerTool(
    "ojs_create_journal",
    {
      title: "Create OJS journal",
      description:
        "Create the first (or another) journal on an existing OJS install via the CLI " +
        "bootstrap recipe — handles the 3 known gotchas (loadAllPlugins throw, missing " +
        "default section, per-context theme enable) so the frontend works immediately.",
      annotations: WRITE,
      inputSchema: {
        domain: domainSchema.describe("OJS subdomain, e.g. journal.example.com"),
        urlPath: z.string().describe("Journal path segment, e.g. myjournal"),
        nameEn: z.string().describe("English journal name"),
        nameAr: z.string().optional().describe("Arabic journal name"),
        acronym: z.string().describe("Acronym, e.g. MYJ"),
        primaryLocale: z.string().default("en"),
        locales: z.array(z.string()).default(["en", "ar"]).describe("Supported locales"),
        docroot: absolutePathSchema.optional().describe("Override docroot path"),
      },
    },
    safe(async (a) => {
      const docroot = a.docroot ?? `${config.ojs.vhostsRoot}/${a.domain}/httpdocs`;
      const script = buildJournalScript({
        domain: a.domain,
        docroot,
        urlPath: a.urlPath,
        primaryLocale: a.primaryLocale,
        locales: a.locales,
        nameByLocale: { en: a.nameEn, ...(a.nameAr ? { ar: a.nameAr } : {}) },
        acronymByLocale: { en: a.acronym },
        phpBin: config.ojs.phpBin,
      });
      return fromExec(await runRemote(script, { timeoutMs: INSTALL_TIMEOUT_MS }));
    })
  );

  server.registerTool(
    "ojs_status",
    {
      title: "OJS status check",
      description:
        "Quick health check of an OJS site: homepage HTTP code, whether config.inc.php " +
        "exists and is installed, and the configured base_url / allowed_hosts.",
      annotations: READ_ONLY,
      inputSchema: {
        domain: domainSchema.describe("OJS subdomain"),
        docroot: absolutePathSchema.optional().describe("Override docroot path"),
      },
    },
    safe(async ({ domain, docroot }) => {
      const root = docroot ?? `${config.ojs.vhostsRoot}/${domain}/httpdocs`;
      const qroot = shellQuote(root);
      const cmd = `echo "homepage:"; curl -sS -o /dev/null -w "  HTTP %{http_code}\\n" "https://${domain}/" || true; echo "config:"; grep -E '^(installed|base_url|allowed_hosts)' ${qroot}/config.inc.php 2>/dev/null | sed 's/^/  /' || echo "  config.inc.php not found at ${root}"`;
      return fromExec(await runRemote(cmd));
    })
  );
}
