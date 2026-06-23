import { describe, it, expect } from "vitest";
import { text, errorText, json, fromExec, safe } from "../src/lib/result.js";

describe("result helpers", () => {
  it("text wraps a string in a content block", () => {
    expect(text("hi")).toEqual({ content: [{ type: "text", text: "hi" }] });
  });

  it("errorText marks the response as an error", () => {
    const r = errorText("boom");
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe("boom");
  });

  it("json pretty-prints values", () => {
    expect(json({ a: 1 }).content[0].text).toBe('{\n  "a": 1\n}');
  });

  describe("fromExec", () => {
    it("returns text on exit 0", () => {
      const r = fromExec({ stdout: "ok", stderr: "", code: 0 });
      expect(r.isError).toBeUndefined();
      expect(r.content[0].text).toBe("ok");
    });
    it("includes stderr and marks error on non-zero exit", () => {
      const r = fromExec({ stdout: "", stderr: "bad", code: 2 });
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toContain("exit 2");
      expect(r.content[0].text).toContain("bad");
    });
    it("falls back to '(no output)' when both streams are empty", () => {
      expect(fromExec({ stdout: "", stderr: "", code: 0 }).content[0].text).toBe("(no output)");
    });
  });

  describe("safe", () => {
    it("passes through successful results", async () => {
      const wrapped = safe(async (x: number) => text(String(x)));
      expect((await wrapped(5)).content[0].text).toBe("5");
    });
    it("converts thrown errors into error responses", async () => {
      const wrapped = safe(async () => {
        throw new Error("kaboom");
      });
      const r = await wrapped();
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toBe("kaboom");
    });
  });
});
