import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCloudflareAccounts } from "../dist/config.js";

test("parses multiple key:token accounts", () => {
  const accts = parseCloudflareAccounts("main:tok1,secondary:tok2");
  assert.deepEqual(accts, [
    { key: "main", token: "tok1" },
    { key: "secondary", token: "tok2" },
  ]);
});

test("tokens containing colons are preserved", () => {
  const accts = parseCloudflareAccounts("main:abc:def:ghi");
  assert.equal(accts[0].token, "abc:def:ghi");
});

test("empty / malformed input yields no accounts", () => {
  assert.deepEqual(parseCloudflareAccounts(""), []);
  assert.deepEqual(parseCloudflareAccounts(undefined), []);
  assert.deepEqual(parseCloudflareAccounts("nocolon"), []);
});
