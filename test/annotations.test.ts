import { describe, it, expect } from "vitest";
import { READ_ONLY, WRITE, IDEMPOTENT_WRITE, DESTRUCTIVE } from "../src/lib/annotations.js";

describe("annotation presets", () => {
  it("READ_ONLY marks the tool as non-mutating", () => {
    expect(READ_ONLY.readOnlyHint).toBe(true);
  });
  it("WRITE mutates but is not destructive and not idempotent", () => {
    expect(WRITE.readOnlyHint).toBe(false);
    expect(WRITE.destructiveHint).toBe(false);
    expect(WRITE.idempotentHint).toBe(false);
  });
  it("IDEMPOTENT_WRITE mutates idempotently and non-destructively", () => {
    expect(IDEMPOTENT_WRITE.readOnlyHint).toBe(false);
    expect(IDEMPOTENT_WRITE.idempotentHint).toBe(true);
    expect(IDEMPOTENT_WRITE.destructiveHint).toBe(false);
  });
  it("DESTRUCTIVE flags potential disruption", () => {
    expect(DESTRUCTIVE.readOnlyHint).toBe(false);
    expect(DESTRUCTIVE.destructiveHint).toBe(true);
  });
});
