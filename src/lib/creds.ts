import { randomBytes } from "node:crypto";

// Unambiguous alphabet (no 0/O/1/I/l) — safe in shells, URLs and DB identifiers.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/** Generate a random password using crypto-strong bytes. */
export function randomPassword(len = 20): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** First DNS label of a domain, sanitised for use in DB names/identifiers. */
export function subLabel(domain: string): string {
  return domain
    .split(".")[0]
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}
