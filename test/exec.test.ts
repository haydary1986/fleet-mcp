import { describe, it, expect } from "vitest";
import { runLocal } from "../src/lib/exec.js";

describe("runLocal", () => {
  it("captures stdout and exit 0 on success", async () => {
    const r = await runLocal("bash", ["-lc", "echo hello"]);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe("hello");
  });

  it("captures a non-zero exit code", async () => {
    const r = await runLocal("bash", ["-lc", "exit 3"]);
    expect(r.code).toBe(3);
  });

  it("captures stderr output", async () => {
    const r = await runLocal("bash", ["-lc", "echo oops 1>&2; exit 1"]);
    expect(r.code).toBe(1);
    expect(r.stderr.trim()).toBe("oops");
  });

  it("reports a failure for a missing binary", async () => {
    const r = await runLocal("this-binary-does-not-exist-xyz", []);
    expect(r.code).not.toBe(0);
  });
});
