import { test } from "node:test";
import assert from "node:assert/strict";
import { text, errorText, fromExec } from "../dist/lib/result.js";

test("text wraps a string in MCP content", () => {
  assert.deepEqual(text("hi"), { content: [{ type: "text", text: "hi" }] });
});

test("errorText marks isError", () => {
  const r = errorText("boom");
  assert.equal(r.isError, true);
  assert.equal(r.content[0].text, "boom");
});

test("fromExec returns success body on code 0", () => {
  const r = fromExec({ stdout: "ok", stderr: "", code: 0 });
  assert.equal(r.isError, undefined);
  assert.match(r.content[0].text, /ok/);
});

test("fromExec surfaces stderr and marks error on non-zero", () => {
  const r = fromExec({ stdout: "", stderr: "bad", code: 7 });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /exit 7/);
  assert.match(r.content[0].text, /bad/);
});
