import { describe, it, expect } from "vitest";
import {
  domainSchema,
  identifierSchema,
  dbHostSchema,
  absolutePathSchema,
  siteSchema,
  containerSchema,
  packageNameSchema,
  goModuleSchema,
  shellQuote,
  sqlStringLiteral,
} from "../src/lib/validate.js";

describe("domainSchema", () => {
  it("accepts valid hostnames", () => {
    for (const d of [
      "example.com",
      "journal.example.com",
      "a.b.c.example.co.uk",
      "localhost",
      "x-y.dev",
    ]) {
      expect(domainSchema.safeParse(d).success).toBe(true);
    }
  });

  it("rejects shell-injection attempts and malformed hosts", () => {
    for (const d of [
      "example.com; rm -rf /",
      "$(whoami).com",
      "`id`.com",
      "a.com && echo pwned",
      "a com",
      "-leadinghyphen.com",
      "",
      "a..b.com",
    ]) {
      expect(domainSchema.safeParse(d).success).toBe(false);
    }
  });
});

describe("identifierSchema", () => {
  it("accepts DB/user identifiers", () => {
    expect(identifierSchema.safeParse("myapp_db").success).toBe(true);
    expect(identifierSchema.safeParse("journal_ojs").success).toBe(true);
  });
  it("rejects quotes, spaces and SQL metacharacters", () => {
    for (const v of ["a'; DROP TABLE x;--", "has space", "name-with-dash", "a.b", ""]) {
      expect(identifierSchema.safeParse(v).success).toBe(false);
    }
  });
});

describe("dbHostSchema", () => {
  it("accepts hosts and wildcards", () => {
    for (const h of ["localhost", "10.0.0.%", "%", "db.internal"]) {
      expect(dbHostSchema.safeParse(h).success).toBe(true);
    }
  });
  it("rejects quote injection", () => {
    expect(dbHostSchema.safeParse("' OR '1'='1").success).toBe(false);
  });
});

describe("absolutePathSchema", () => {
  it("accepts clean absolute paths", () => {
    expect(absolutePathSchema.safeParse("/var/www/vhosts").success).toBe(true);
    expect(absolutePathSchema.safeParse("/root/backups").success).toBe(true);
  });
  it("rejects relative paths and shell metacharacters", () => {
    for (const p of ["relative/path", "/tmp/$(id)", "/a;rm -rf /", "/a`b`", "/a|b", "/a&b"]) {
      expect(absolutePathSchema.safeParse(p).success).toBe(false);
    }
  });
});

describe("siteSchema", () => {
  it("accepts a domain or an absolute path", () => {
    expect(siteSchema.safeParse("example.com").success).toBe(true);
    expect(siteSchema.safeParse("/var/www/vhosts/example.com/httpdocs").success).toBe(true);
  });
  it("rejects metacharacter injection in either form", () => {
    expect(siteSchema.safeParse("a.com;reboot").success).toBe(false);
    expect(siteSchema.safeParse("/a/$(id)").success).toBe(false);
  });
});

describe("containerSchema", () => {
  it("accepts docker names/ids", () => {
    expect(containerSchema.safeParse("web_1").success).toBe(true);
    expect(containerSchema.safeParse("a1b2c3d4").success).toBe(true);
  });
  it("rejects injection", () => {
    expect(containerSchema.safeParse("x; rm -rf /").success).toBe(false);
  });
});

describe("packageNameSchema / goModuleSchema", () => {
  it("accepts typical names", () => {
    expect(packageNameSchema.safeParse("my-app").success).toBe(true);
    expect(goModuleSchema.safeParse("github.com/you/app").success).toBe(true);
  });
  it("rejects path traversal / injection", () => {
    expect(packageNameSchema.safeParse("../etc").success).toBe(false);
    expect(goModuleSchema.safeParse("a; rm -rf /").success).toBe(false);
  });
});

describe("shellQuote", () => {
  it("wraps in single quotes", () => {
    expect(shellQuote("hello")).toBe("'hello'");
  });
  it("neutralises embedded single quotes", () => {
    expect(shellQuote("a'b")).toBe("'a'\\''b'");
  });
  it("neutralises command substitution and separators", () => {
    expect(shellQuote("$(id); rm -rf /")).toBe("'$(id); rm -rf /'");
  });
});

describe("sqlStringLiteral", () => {
  it("escapes single quotes and backslashes", () => {
    expect(sqlStringLiteral("ab")).toBe("'ab'");
    expect(sqlStringLiteral("a'b")).toBe("'a\\'b'");
    expect(sqlStringLiteral("a\\b")).toBe("'a\\\\b'");
  });
  it("neutralises a classic injection payload", () => {
    expect(sqlStringLiteral("'; DROP TABLE users;--")).toBe("'\\'; DROP TABLE users;--'");
  });
});
