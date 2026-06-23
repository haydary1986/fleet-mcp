import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config } from "../config.js";
import { runRemote } from "../lib/exec.js";
import { fromExec, text, errorText, safe } from "../lib/result.js";
import { randomPassword, subLabel } from "../lib/creds.js";
import { cf, zoneId } from "../lib/cloudflare.js";
import { buildInstallScript, buildJournalScript } from "../lib/ojs-scripts.js";

const INSTALL_TIMEOUT_MS = 300_000; // downloads + install can take minutes

/** Create a gray (DNS-only) A record so LE HTTP-01 can validate at the origin. */
async function createGrayRecord(
  cfAccount: string | undefined,
  zone: string,
  name: string,
  ip: string
): Promise<{ zoneId: string; note: string }> {
  const zid = await zoneId(cfAccount, zone);
  try {
    await cf(cfAccount, `/zones/${zid}/dns_records`, {
      method: "POST",
      body: JSON.stringify({ type: "A", name, content: ip, ttl: 1, proxied: false }),
    });
    return { zoneId: zid, note: `DNS: created A ${name} -> ${ip} (gray)\n` };
  } catch (err: any) {
    return { zoneId: zid, note: `DNS: ${String(err?.message ?? err)} (continuing — record may already exist)\n` };
  }
}

/** Flip a record to proxied (orange) once the origin has a valid cert. */
async function flipProxied(cfAccount: string | undefined, zid: string, fqdn: string): Promise<string> {
  try {
    const listed = await cf(cfAccount, `/zones/${zid}/dns_records?name=${encodeURIComponent(fqdn)}`);
    const rec = listed.result?.[0];
    if (!rec) return `DNS: ${fqdn} not found to flip proxied\n`;
    await cf(cfAccount, `/zones/${zid}/dns_records/${rec.id}`, {
      method: "PATCH",
      body: JSON.stringify({ proxied: true }),
    });
    return `DNS: flipped ${fqdn} to proxied (orange)\n`;
  } catch (err: any) {
    return `DNS: could not flip to proxied: ${String(err?.message ?? err)}\n`;
  }
}

export function registerOjs(server: McpServer) {
  server.registerTool(
    "ojs_install",
    {
      title: "Install OJS journal",
      description:
        "Provision and install OJS. With provision=true it does the FULL from-scratch " +
        "flow: create the Cloudflare A record (gray), create the Plesk subdomain, deploy " +
        "files, create DB+user, run the CLI installer, patch config.inc.php, set perms + " +
        "PHP handler, issue a Let's Encrypt cert, then flip the record to proxied. With " +
        "provision=false it installs into an EXISTING webspace. Generates admin + DB " +
        "passwords and returns the access details.",
      inputSchema: {
        domain: z.string().describe("Full subdomain, e.g. journal.example.com"),
        provision: z
          .boolean()
          .default(false)
          .describe("Create DNS + Plesk subdomain + LE cert from scratch"),
        parentDomain: z
          .string()
          .optional()
          .describe("Cloudflare zone + Plesk subscription domain (required when provision=true)"),
        originIp: z
          .string()
          .optional()
          .describe("Server IP for the A record (required when provision=true)"),
        cfAccount: z.string().optional().describe("Cloudflare account key from CF_ACCOUNTS"),
        issueLE: z.boolean().default(true).describe("Issue a Let's Encrypt cert (provision mode)"),
        pleskDomain: z
          .string()
          .optional()
          .describe("Plesk subscription domain for DB commands; defaults to parentDomain or domain"),
        adminEmail: z.string().email().optional().describe("Admin email (defaults to OJS_ADMIN_EMAIL)"),
        docroot: z.string().optional().describe("Override docroot (ignored in provision mode)"),
        filesDir: z.string().optional().describe("Override OJS files dir (outside webroot)"),
        primaryLocale: z.string().default("en").describe("Primary locale key"),
        additionalLocales: z.string().default("ar").describe("Comma-separated extra locale keys"),
        setPhpHandler: z.boolean().default(true).describe("Set the Plesk PHP handler to php81 fastcgi"),
        createJournal: z.boolean().default(false).describe("Also create the first journal"),
        journalPath: z.string().optional().describe("urlPath for the journal when createJournal=true"),
        journalNameEn: z.string().optional().describe("English journal name when createJournal=true"),
        journalNameAr: z.string().optional().describe("Arabic journal name when createJournal=true"),
        acronym: z.string().optional().describe("Journal acronym when createJournal=true"),
      },
    },
    safe(async (a) => {
      const adminEmail = a.adminEmail ?? config.ojs.adminEmail;
      if (!adminEmail) {
        return errorText("No admin email. Pass adminEmail or set OJS_ADMIN_EMAIL.");
      }

      const label = subLabel(a.domain);
      const adminUser = "admin";
      const adminPass = randomPassword(18);
      const dbName = `${label}_ojs`;
      const dbUser = `${label}_ojs`;
      const dbPass = randomPassword(20);

      let pleskDomain = a.pleskDomain ?? a.domain;
      let docroot = a.docroot ?? `${config.ojs.vhostsRoot}/${a.domain}/httpdocs`;
      let filesDir = a.filesDir ?? `${config.ojs.vhostsRoot}/${a.domain}/ojs-files`;
      let provision: { sublabel: string } | undefined;
      let cfNote = "";
      let zid = "";

      if (a.provision) {
        if (!a.parentDomain || !a.originIp) {
          return errorText("provision=true requires parentDomain and originIp.");
        }
        if (!a.domain.endsWith(`.${a.parentDomain}`)) {
          return errorText(
            `domain (${a.domain}) must be a subdomain of parentDomain (${a.parentDomain}).`
          );
        }
        const sublabel = a.domain.slice(0, a.domain.length - a.parentDomain.length - 1);
        pleskDomain = a.pleskDomain ?? a.parentDomain;
        filesDir = `${config.ojs.vhostsRoot}/${a.parentDomain}/${label}-files`;
        docroot = ""; // discovered in-script after subdomain creation
        provision = { sublabel };

        const dns = await createGrayRecord(a.cfAccount, a.parentDomain, sublabel, a.originIp);
        zid = dns.zoneId;
        cfNote += dns.note;
      }

      const script = buildInstallScript({
        domain: a.domain,
        pleskDomain,
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
        provision,
        issueLE: a.provision ? a.issueLE : false,
      });

      const installLog = await runRemote(script, { timeoutMs: INSTALL_TIMEOUT_MS });

      let journalLog = "";
      if (a.createJournal) {
        const urlPath = a.journalPath ?? label;
        const journalScript = buildJournalScript({
          domain: a.domain,
          docroot: a.provision ? undefined : docroot, // discover when provisioned (siteN)
          urlPath,
          primaryLocale: a.primaryLocale,
          locales: [
            a.primaryLocale,
            ...a.additionalLocales.split(",").map((s) => s.trim()).filter(Boolean),
          ],
          nameByLocale: { en: a.journalNameEn ?? a.domain, ...(a.journalNameAr ? { ar: a.journalNameAr } : {}) },
          acronymByLocale: { en: a.acronym ?? label.toUpperCase() },
          phpBin: config.ojs.phpBin,
        });
        const r = await runRemote(journalScript, { timeoutMs: INSTALL_TIMEOUT_MS });
        journalLog = `\n\n=== JOURNAL CREATION ===\n${r.stdout}\n${r.stderr}`;
      }

      if (a.provision && installLog.code === 0) {
        cfNote += await flipProxied(a.cfAccount, zid, a.domain);
      }

      const creds =
        `\n\n=== ACCESS DETAILS (save these) ===\n` +
        `URL:           https://${a.domain}/\n` +
        `Admin login:   ${adminUser}\n` +
        `Admin pass:    ${adminPass}\n` +
        `Admin email:   ${adminEmail}\n` +
        `DB name/user:  ${dbName} / ${dbUser}\n` +
        `DB password:   ${dbPass}\n` +
        (a.createJournal ? `Journal URL:   https://${a.domain}/index.php/${a.journalPath ?? label}/\n` : "");

      const body = `${installLog.stdout}\n${installLog.stderr}${journalLog}\n\n${cfNote}${creds}`;
      return installLog.code === 0 ? text(body) : errorText(body);
    })
  );

  server.registerTool(
    "ojs_create_journal",
    {
      title: "Create OJS journal",
      description:
        "Create a journal on an existing OJS install via the CLI bootstrap recipe — handles " +
        "the 3 known gotchas (loadAllPlugins throw, missing default section, per-context theme " +
        "enable). Docroot is discovered automatically when not provided.",
      inputSchema: {
        domain: z.string().describe("OJS subdomain, e.g. journal.example.com"),
        urlPath: z.string().describe("Journal path segment, e.g. myjournal"),
        nameEn: z.string().describe("English journal name"),
        nameAr: z.string().optional().describe("Arabic journal name"),
        acronym: z.string().describe("Acronym, e.g. MYJ"),
        primaryLocale: z.string().default("en"),
        locales: z.array(z.string()).default(["en", "ar"]).describe("Supported locales"),
        docroot: z.string().optional().describe("Override docroot (else discovered)"),
      },
    },
    safe(async (a) => {
      const script = buildJournalScript({
        domain: a.domain,
        docroot: a.docroot,
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
        "Quick health check of an OJS site: homepage HTTP code, whether config.inc.php exists " +
        "and is installed, and the configured base_url / allowed_hosts.",
      inputSchema: {
        domain: z.string().describe("OJS subdomain"),
        docroot: z.string().optional().describe("Override docroot path"),
      },
    },
    safe(async ({ domain, docroot }) => {
      const root = docroot ?? `${config.ojs.vhostsRoot}/${domain}/httpdocs`;
      const cmd = `echo "homepage:"; curl -sS -o /dev/null -w "  HTTP %{http_code}\\n" "https://${domain}/" || true; echo "config:"; grep -E '^(installed|base_url|allowed_hosts)' "${root}/config.inc.php" 2>/dev/null | sed 's/^/  /' || echo "  config.inc.php not found at ${root}"`;
      return fromExec(await runRemote(cmd));
    })
  );
}
