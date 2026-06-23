import { describe, it, expect, vi, afterEach } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("requireSsh", () => {
  it("throws a helpful error when FLEET_SSH_TARGET is unset", async () => {
    vi.stubEnv("FLEET_SSH_TARGET", "");
    vi.resetModules();
    const { requireSsh } = await import("../src/config.js");
    expect(() => requireSsh()).toThrow(/FLEET_SSH_TARGET/);
  });

  it("returns the configured target", async () => {
    vi.stubEnv("FLEET_SSH_TARGET", "root@host.example");
    vi.resetModules();
    const { requireSsh } = await import("../src/config.js");
    expect(requireSsh()).toBe("root@host.example");
  });
});
