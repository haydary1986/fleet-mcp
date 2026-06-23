import { describe, it, expect } from "vitest";
import { randomPassword, subLabel } from "../src/lib/creds.js";

describe("randomPassword", () => {
  it("produces the requested length", () => {
    expect(randomPassword(20)).toHaveLength(20);
    expect(randomPassword(8)).toHaveLength(8);
  });
  it("uses only the unambiguous, shell-safe alphabet", () => {
    const pw = randomPassword(200);
    expect(pw).toMatch(/^[A-HJ-NP-Za-km-z2-9]+$/); // no 0/O/1/I/l
  });
  it("is non-deterministic", () => {
    expect(randomPassword(24)).not.toBe(randomPassword(24));
  });
});

describe("subLabel", () => {
  it("takes the first DNS label, lowercased and sanitised", () => {
    expect(subLabel("Journal.example.com")).toBe("journal");
    expect(subLabel("my-site.example.com")).toBe("mysite");
    expect(subLabel("ABC123.test")).toBe("abc123");
  });
});
