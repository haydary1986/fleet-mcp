// Input validation + shell/SQL escaping helpers.
//
// Many tools build shell commands (often run over SSH) or SQL strings by
// interpolating caller-supplied values. Because a model may construct those
// values from untrusted data, every interpolated value is either constrained to
// a safe character set with a Zod schema at the tool boundary, or escaped here
// before it reaches a shell / SQL context. Defense in depth: validate AND quote.

import { z } from "zod";

// A DNS hostname: dot-separated labels of letters/digits/hyphens, 1–253 chars.
// Deliberately excludes every shell metacharacter, so a validated domain is
// always safe to interpolate into a command string.
const DOMAIN_RE =
  /^(?=.{1,253}$)([A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

/** A hostname such as `example.com` or `journal.example.com` (no protocol). */
export const domainSchema = z
  .string()
  .regex(DOMAIN_RE, "must be a valid hostname (letters, digits, hyphens and dots only)");

// A SQL/database identifier: letters, digits and underscores, max 64 chars
// (MySQL's identifier length limit). Matches Plesk-generated DB/user names.
const IDENT_RE = /^[A-Za-z0-9_]{1,64}$/;

/** A MySQL database name or user name. */
export const identifierSchema = z
  .string()
  .regex(IDENT_RE, "must contain only letters, digits and underscores (max 64)");

// A MySQL host/grant host: hostnames, IPs and the % wildcard.
const DB_HOST_RE = /^[A-Za-z0-9_.%-]{1,255}$/;

/** A MySQL grant host such as `localhost`, `10.0.0.%` or `%`. */
export const dbHostSchema = z
  .string()
  .regex(DB_HOST_RE, "invalid host (letters, digits, dots, %, - and _ only)");

// Characters that have special meaning to a POSIX shell. A path containing any
// of these is rejected outright; everything else is additionally shell-quoted.
const SHELL_META_RE = /[`$;&|<>(){}*?!\\"'\n\r]/;

/** An absolute filesystem path with no shell metacharacters. */
export const absolutePathSchema = z
  .string()
  .min(1)
  .refine((s) => s.startsWith("/"), "must be an absolute path (start with /)")
  .refine((s) => !SHELL_META_RE.test(s), "must not contain shell metacharacters");

/** A site reference: either an absolute path or a hostname. */
export const siteSchema = z
  .string()
  .min(1)
  .refine(
    (s) => (s.startsWith("/") ? !SHELL_META_RE.test(s) : DOMAIN_RE.test(s)),
    "must be a hostname (example.com) or an absolute docroot path"
  );

// A Docker container name or id. Docker names match [a-zA-Z0-9][a-zA-Z0-9_.-]+.
const CONTAINER_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

/** A Docker container name or id. */
export const containerSchema = z.string().regex(CONTAINER_RE, "invalid container name or id");

// A project/package/folder name: letters, digits, dot, underscore, hyphen.
const PKG_NAME_RE = /^[A-Za-z0-9._-]{1,128}$/;

/** A package or folder name (no path separators or shell metacharacters). */
export const packageNameSchema = z
  .string()
  .regex(PKG_NAME_RE, "invalid name (letters, digits, dot, underscore, hyphen only)");

// A Go module path such as github.com/you/app.
const GO_MODULE_RE = /^[A-Za-z0-9._/-]{1,200}$/;

/** A Go module path, e.g. github.com/you/app. */
export const goModuleSchema = z.string().regex(GO_MODULE_RE, "invalid Go module path");

/**
 * Quote a string for safe use as a single POSIX-shell argument.
 * Wraps in single quotes and escapes embedded single quotes as '\'' .
 */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Render a string as a MySQL single-quoted string literal, escaping backslashes
 * and single quotes. Use for values embedded inside SQL (e.g. passwords).
 */
export function sqlStringLiteral(s: string): string {
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}
