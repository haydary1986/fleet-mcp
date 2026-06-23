import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInstallScript, buildJournalScript } from "../dist/lib/ojs-scripts.js";

const base = {
  domain: "journal.example.com",
  pleskDomain: "example.com",
  docroot: "/var/www/vhosts/example.com/httpdocs",
  filesDir: "/var/www/vhosts/example.com/ojs-files",
  dbName: "ex_ojs",
  dbUser: "ex_ojs",
  dbPass: "Abc123Def456",
  adminUser: "admin",
  adminPass: "Pass1234Pass",
  adminEmail: "admin@example.com",
  primaryLocale: "en",
  additionalLocales: "ar",
  oaiRepoId: "ex.ojs",
  phpBin: "/opt/plesk/php/8.1/bin/php",
  version: "3.4.0-9",
  downloadBase: "https://pkp.sfu.ca/ojs/download",
  phpHandler: "plesk-php81-fastcgi",
  setPhpHandler: true,
};

test("install script runs the CLI installer and patches config", () => {
  const s = buildInstallScript(base);
  assert.match(s, /tools\/install\.php/);
  assert.match(s, /allowed_hosts/);
  assert.match(s, /trust_x_forwarded_for/);
  assert.match(s, /-server localhost -type mysql/); // dbuser flags
});

test("install dedup logic removes all matches before inserting", () => {
  const s = buildInstallScript(base);
  assert.match(s, /Remove ALL existing/); // the fixed set_ini
  assert.match(s, /\[general\]/);
});

test("non-provision install does NOT create a subdomain or issue LE", () => {
  const s = buildInstallScript(base);
  assert.doesNotMatch(s, /plesk bin subdomain --create/);
  assert.doesNotMatch(s, /letsencrypt cli\.php/);
});

test("provision install creates subdomain, discovers docroot, issues LE", () => {
  const s = buildInstallScript({ ...base, provision: { sublabel: "journal" }, issueLE: true });
  assert.match(s, /plesk bin subdomain --create journal -domain example\.com/);
  assert.match(s, /plesk bin subdomain --info journal\.example\.com/);
  assert.match(s, /letsencrypt cli\.php -d journal\.example\.com/);
});

test("journal script with explicit docroot embeds the bootstrap + 3 gotchas", () => {
  const s = buildJournalScript({
    domain: "journal.example.com",
    docroot: "/var/www/vhosts/example.com/site5",
    urlPath: "myj",
    primaryLocale: "en",
    locales: ["en", "ar"],
    nameByLocale: { en: "My Journal" },
    acronymByLocale: { en: "MYJ" },
    phpBin: "/opt/plesk/php/8.1/bin/php",
  });
  assert.match(s, /DOCROOT="\/var\/www\/vhosts\/example\.com\/site5"/);
  assert.match(s, /mkjournal\.php/);
  assert.match(s, /base64 -d/);
  // the PHP bootstrap is base64-encoded inside the script — decode and verify.
  const m = s.match(/echo "([A-Za-z0-9+\/=]+)" \| base64 -d/);
  assert.ok(m, "should embed a base64 PHP payload");
  const php = Buffer.from(m[1], "base64").toString("utf8");
  assert.match(php, /getByPath/); // gotcha 1: recover after loadAllPlugins throw
  assert.match(php, /default section/i); // gotcha 2
  assert.match(php, /defaultthemeplugin/); // gotcha 3: per-context theme
  assert.match(php, /PluginSettingsDAO/);
});

test("journal script discovers docroot when not provided", () => {
  const s = buildJournalScript({
    domain: "journal.example.com",
    urlPath: "myj",
    primaryLocale: "en",
    locales: ["en"],
    nameByLocale: { en: "My Journal" },
    acronymByLocale: { en: "MYJ" },
    phpBin: "/opt/plesk/php/8.1/bin/php",
  });
  assert.match(s, /plesk bin subdomain --info journal\.example\.com/);
});
