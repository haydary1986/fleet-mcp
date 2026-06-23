// Bearer-token helpers for the HTTP transport.
import { timingSafeEqual } from "node:crypto";

/**
 * Compare two secrets in constant time to avoid leaking length/byte information
 * through timing. Returns false for any length mismatch or empty expected token.
 */
export function safeTokenEquals(provided: string, expected: string): boolean {
  if (!expected) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Extract the token from an `Authorization: Bearer <token>` header value. */
export function bearerToken(header: string | undefined): string {
  const h = header ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}
