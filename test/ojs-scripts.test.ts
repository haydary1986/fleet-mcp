import { describe, it, expect } from "vitest";
import { buildInstallScript, buildJournalScript } from "../src/lib/ojs-scripts.js";

function decodeEmbeddedBase64(script: string): string {
  const m = script.match(/echo "([A-Za-z0-9+/=]+)" \| base64 -d/);
  if (!m) throw new Error("no base64 payload found in script");
  return Buffer.from(m[1], "base64").toString("utf8");
}

describe("buildInstallScript", () => {
  const script = buildInstallScript({
    domain: "journal.example.com",
    docroot: "/var/www/vhosts/journal.example.com/httpdocs",
    filesDir: "/var/www/vhosts/journal.example.com/ojs-files",
    dbName: "journal_ojs",
    dbUser: "journal_ojs",
    dbPass: "abc123",
    adminUser: "admin",
    adminPass: "secret",
    adminEmail: "admin@example.com",
    primaryLocale: "en",
    additionalLocales: "ar",
    oaiRepoId: "journal.ojs",
    phpBin: "/opt/plesk/php/8.1/bin/php",
    version: "3.4.0-9",
    downloadBase: "https://pkp.sfu.ca/ojs/download",
    phpHandler: "plesk-php81-fastcgi",
    setPhpHandler: true,
  });

  it("references the docroot, domain and version", () => {
    expect(script).toContain("/var/www/vhosts/journal.example.com/httpdocs");
    expect(script).toContain("journal.example.com");
    expect(script).toContain("ojs-3.4.0-9.tar.gz");
  });
  it("includes the PHP handler step when requested", () => {
    expect(script).toContain("plesk-php81-fastcgi");
  });
  it("omits the handler step when not requested", () => {
    const s = buildInstallScript({
      domain: "j.example.com",
      docroot: "/d",
      filesDir: "/f",
      dbName: "d",
      dbUser: "u",
      dbPass: "p",
      adminUser: "admin",
      adminPass: "x",
      adminEmail: "a@b.c",
      primaryLocale: "en",
      additionalLocales: "ar",
      oaiRepoId: "x.ojs",
      phpBin: "php",
      version: "3.4.0-9",
      downloadBase: "https://x",
      phpHandler: "h",
      setPhpHandler: false,
    });
    expect(s).not.toContain("Set PHP handler");
  });
});

describe("buildJournalScript", () => {
  it("escapes single quotes in PHP string literals", () => {
    const script = buildJournalScript({
      domain: "journal.example.com",
      docroot: "/var/www/vhosts/journal.example.com/httpdocs",
      urlPath: "myj",
      primaryLocale: "en",
      locales: ["en", "ar"],
      nameByLocale: { en: "O'Brien Journal" },
      acronymByLocale: { en: "OBJ" },
      phpBin: "php",
    });
    const php = decodeEmbeddedBase64(script);
    expect(php).toContain("O\\'Brien Journal");
    expect(php).toContain("'myj'");
    expect(php).toContain("'en','ar'");
  });
});
