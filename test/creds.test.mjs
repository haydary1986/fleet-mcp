import { test } from "node:test";
import assert from "node:assert/strict";
import { randomPassword, subLabel } from "../dist/lib/creds.js";

test("randomPassword respects length", () => {
  assert.equal(randomPassword(18).length, 18);
  assert.equal(randomPassword(32).length, 32);
});

test("randomPassword uses only the safe alphabet", () => {
  const pw = randomPassword(200);
  // alphabet excludes uppercase I/O and lowercase l, plus 0/1 — no symbols
  assert.match(pw, /^[A-HJ-NP-Za-km-z2-9]+$/);
  assert.doesNotMatch(pw, /[IOl01]/);
});

test("randomPassword is non-deterministic", () => {
  assert.notEqual(randomPassword(24), randomPassword(24));
});

test("subLabel extracts and sanitises the first DNS label", () => {
  assert.equal(subLabel("ojs-demo.erticaz.com"), "ojsdemo");
  assert.equal(subLabel("Journal_2.example.com"), "journal2");
  assert.equal(subLabel("shop.example.co.uk"), "shop");
});
