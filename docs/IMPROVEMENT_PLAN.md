# fleet-mcp — Review & Improvement Plan / المراجعة وخطة التحسين

> ملخص بالعربية: هذا المستند يراجع خادم `fleet-mcp` بعد تحسينات الإصدار **v1.1.0**
> (تعليقات الأدوات، التحقق من المدخلات ومنع الحقن، الموارد والـ Prompts، أداة
> التشخيص `fleet_doctor`، تقوية نقل HTTP، الاختبارات وCI) ثم يقترح خارطة طريق
> مرتّبة حسب الأولوية للخطوات القادمة (P1 الأهم ← P3 تحسينات إضافية).

Last reviewed: 2026-06-23 · Branch: `improve/mcp-best-practices`

---

## 1. What was delivered in this pass (v1.1.0)

| Area               | Change                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| MCP best practices | Tool **annotations** (`readOnly`/`destructive`/`idempotent`/`openWorld`) on all ~38 tools               |
| MCP capabilities   | **Resources** (`fleet://config`, `fleet://setup`) and **Prompts** (`audit-site`, `install-ojs-journal`) |
| Structured output  | `outputSchema` + `structuredContent` on `check_all_sites` and `ssl_expiry`                              |
| Security           | Input validation schemas + `shellQuote`/`sqlStringLiteral` closing command/SQL injection vectors        |
| Security (HTTP)    | helmet headers, per-IP rate limiting, **constant-time** bearer-token comparison                         |
| DX / ops           | `fleet_doctor` preflight tool; version read from `package.json` (no more drift)                         |
| Config             | Fail-fast validation of numeric env vars while keeping the "configure one at a time" model              |
| Quality            | Vitest suite (110 tests, ~90% line coverage), ESLint (flat config), Prettier, GitHub Actions CI         |

---

## 2. Review summary

### Strengths (kept intact)

- Clean, transport-agnostic architecture (`createServer` shared by stdio + HTTP).
- Small, focused files; consistent `safe()` error wrapper and `fromExec` shaping.
- Smart base64-piping for SQL/scripts to dodge shell quoting.
- Lazy, per-integration config — you can enable one service at a time.

### Residual risks / known gaps (addressed by the roadmap below)

1. **`any` at the API boundaries** (`lib/cloudflare.ts`, `lib/coolify.ts`) — currently
   an ESLint _warning_. Untyped JSON flows into tool output.
2. **No audit trail.** A server that can `run_ssh` as root should record who ran what.
3. **No per-tool authorization** in HTTP mode — one token unlocks every tool, including
   `run_ssh`. Fine for a trusted team, risky as the team grows.
4. **Branch-coverage** (~68%) trails line-coverage; the gaps are defensive fallbacks
   and the third-party API error paths.
5. **`run_ssh` / `wp` / `docker_raw` / `gh` are unconstrained** by design. They are the
   right escape hatch, but there's no optional allow/deny-list for locked-down setups.
6. No `LICENSE`, `CONTRIBUTING.md`, or `CHANGELOG.md`.

---

## 3. Roadmap (prioritized)

### P1 — high value, low effort

- **Audit logging.** Wrap every tool handler (in `createServer`) to log
  `{ts, tool, argsRedacted, durationMs, ok}` to stderr/file. ~Half a day. Pairs well
  with the existing `safe()` wrapper — add a `withAudit()` decorator.
- **Type the API clients.** Replace `any` in `lib/cloudflare.ts` / `lib/coolify.ts`
  with small response interfaces (or `zod` parsing of responses). Removes the 10 lint
  warnings and hardens output shaping.
- **`LICENSE` + `CHANGELOG.md` + `CONTRIBUTING.md`.** Needed before publishing to npm.
- **Publish to npm / `npx fleet-mcp`.** The `bin` is already wired; add a prepublish
  build and a `files` allowlist check.

### P2 — medium effort, strong payoff

- **Optional command allow/deny-list** for `run_ssh`, `wp`, `docker_raw`, `gh` via env
  (e.g. `FLEET_SSH_DENY=rm -rf,mkfs`). Defense for shared/HTTP deployments.
- **Per-token scopes in HTTP mode.** Map tokens → allowed tool groups so a teammate can
  get read-only access. Small middleware + a `MCP_TOKENS` map.
- **More structured output.** Extend `outputSchema` to `cf_dns_list`, `docker_ps`,
  `mysql_table_sizes`, `coolify_apps` so clients get machine-readable rows.
- **Resource templates.** e.g. `fleet://ssl/{domain}` and `fleet://zone/{domain}` as
  read-only context resources (mirrors the tools but cacheable as context).
- **Pagination / output caps.** Large `mysql_query` / `docker_logs` results can blow the
  10 MB exec buffer; add explicit `limit` + truncation notices.

### P3 — nice to have

- **Progress notifications** for long jobs (`ojs_install`, `dev_check`) via the MCP
  progress channel instead of one big blob at the end.
- **Stateful HTTP sessions** (the transport supports a session id generator) if you ever
  need server-initiated messages.
- **Dependabot / `npm audit` in CI**, plus coverage upload (Codecov).
- **Raise branch-coverage threshold** to 75%+ by testing API error paths.

---

## 4. New tool / capability ideas (from the awesome-mcp landscape)

Scoped to the existing "hosting fleet" mission — not everything, just high-signal adds:

- **Cloudflare:** `cf_purge_cache` (purge by URL/everything), `cf_analytics`,
  `cf_firewall_rule` — cache purge in particular is a daily task.
- **Sites/Server:** `service_restart` (systemctl), `ssl_renew` (certbot/Plesk),
  `tail_log` (nginx/php-fpm/litespeed error logs), `firewall_status`.
- **Backups:** `backup_site` (files + DB in one call), `restore_db`, and an off-box
  copy step (rsync/S3) — currently `mysql_dump` only lands on the same server.
- **Plesk-native:** `plesk_create_subdomain` so the OJS prerequisite ("subdomain must
  already exist") can be satisfied from the same tool surface.
- **Observability:** `fleet_overview` resource that aggregates `check_all_sites` +
  `disk_usage` + cert expiries into one dashboard read.

---

## 5. Suggested next milestone (v1.2.0)

1. Audit logging (`withAudit` wrapper) — P1
2. Type the Cloudflare/Coolify clients — P1
3. `cf_purge_cache` + `service_restart` + `tail_log` — P2 (highest day-to-day value)
4. LICENSE + CHANGELOG + npm publish — P1

Each is independently shippable; (1) and (2) clear the remaining lint/quality debt,
(3) adds the most-requested fleet operations, (4) makes it installable for others.
