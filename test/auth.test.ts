import { describe, it, expect } from "vitest";
import { safeTokenEquals, bearerToken } from "../src/lib/auth.js";

describe("safeTokenEquals", () => {
  it("returns true for identical non-empty tokens", () => {
    expect(safeTokenEquals("s3cret-token", "s3cret-token")).toBe(true);
  });
  it("returns false for mismatched tokens", () => {
    expect(safeTokenEquals("wrong", "s3cret-token")).toBe(false);
  });
  it("returns false on length mismatch without throwing", () => {
    expect(safeTokenEquals("short", "a-much-longer-token")).toBe(false);
  });
  it("returns false when the expected token is empty", () => {
    expect(safeTokenEquals("anything", "")).toBe(false);
    expect(safeTokenEquals("", "")).toBe(false);
  });
});

describe("bearerToken", () => {
  it("extracts the token after 'Bearer '", () => {
    expect(bearerToken("Bearer abc123")).toBe("abc123");
  });
  it("returns empty for missing or malformed headers", () => {
    expect(bearerToken(undefined)).toBe("");
    expect(bearerToken("Basic abc")).toBe("");
    expect(bearerToken("abc")).toBe("");
  });
});
