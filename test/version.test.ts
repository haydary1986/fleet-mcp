import { describe, it, expect } from "vitest";
import { NAME, VERSION } from "../src/lib/version.js";

describe("version", () => {
  it("exposes the server name", () => {
    expect(NAME).toBe("fleet-mcp");
  });
  it("reads a semver string from package.json", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
    expect(VERSION).not.toBe("0.0.0");
  });
});
