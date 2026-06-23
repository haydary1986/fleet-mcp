import { describe, it, expect, afterEach } from "vitest";
import { parseCloudflareAccounts, intEnv } from "../src/config.js";

describe("parseCloudflareAccounts", () => {
  it("returns [] for empty/undefined input", () => {
    expect(parseCloudflareAccounts(undefined)).toEqual([]);
    expect(parseCloudflareAccounts("  ")).toEqual([]);
  });
  it("parses key:token pairs", () => {
    expect(parseCloudflareAccounts("main:tok1,secondary:tok2")).toEqual([
      { key: "main", token: "tok1" },
      { key: "secondary", token: "tok2" },
    ]);
  });
  it("keeps colons inside the token", () => {
    expect(parseCloudflareAccounts("main:a:b:c")).toEqual([{ key: "main", token: "a:b:c" }]);
  });
  it("skips malformed pairs", () => {
    expect(parseCloudflareAccounts("noColon,main:tok")).toEqual([{ key: "main", token: "tok" }]);
  });
});

describe("intEnv", () => {
  const KEY = "FLEET_TEST_INT";
  afterEach(() => {
    delete process.env[KEY];
  });

  it("returns the fallback when unset or blank", () => {
    expect(intEnv(KEY, 42)).toBe(42);
    process.env[KEY] = "  ";
    expect(intEnv(KEY, 42)).toBe(42);
  });
  it("parses a valid integer", () => {
    process.env[KEY] = "8080";
    expect(intEnv(KEY, 1)).toBe(8080);
  });
  it("throws on non-integer values", () => {
    process.env[KEY] = "not-a-number";
    expect(() => intEnv(KEY, 1)).toThrow(/must be an integer/);
    process.env[KEY] = "3.14";
    expect(() => intEnv(KEY, 1)).toThrow(/must be an integer/);
  });
  it("enforces bounds", () => {
    process.env[KEY] = "0";
    expect(() => intEnv(KEY, 1, { min: 1 })).toThrow(/>= 1/);
    process.env[KEY] = "99999";
    expect(() => intEnv(KEY, 1, { max: 65535 })).toThrow(/<= 65535/);
  });
});
