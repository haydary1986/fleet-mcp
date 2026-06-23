# fleet-mcp

A single MCP server that bundles the tools you use every day to run your hosting
fleet — **SSH/Plesk, WordPress (wp-cli), Cloudflare, MySQL, GitHub, Docker, and
Coolify** — so you can drive all of it from Claude with plain language.

## Tools

| Group          | Tools                                                                                 |
| -------------- | ------------------------------------------------------------------------------------- |
| **SSH**        | `run_ssh`                                                                             |
| **Sites**      | `site_status`, `check_all_sites`, `ssl_expiry`, `disk_usage`                          |
| **WordPress**  | `wp`, `wp_update_plugins`, `wp_purge_lscache`, `wp_health`, `wp_php_handler`          |
| **Cloudflare** | `cf_zone_status`, `cf_dns_list`, `cf_dns_add`, `cf_toggle_proxy`, `cf_export_records` |
| **MySQL**      | `mysql_query`, `mysql_table_sizes`, `mysql_create_user`, `mysql_dump`                 |
| **GitHub**     | `gh`, `gh_pr_list`, `gh_create_issue`                                                 |
| **Docker**     | `docker_ps`, `docker_logs`, `docker_restart`, `docker_raw`                            |
| **Coolify**    | `coolify_servers`, `coolify_apps`, `coolify_deploy`, `coolify_resources`              |
| **OJS**        | `ojs_install`, `ojs_create_journal`, `ojs_status`                                     |
| **Dev**        | `dev_check`, `scaffold_nextjs`, `scaffold_go`, `scaffold_ts_lib`, `dockerize`         |
| **Doctor**     | `fleet_doctor`                                                                        |

Every tool carries MCP **annotations** (`readOnlyHint` / `destructiveHint` /
`idempotentHint` / `openWorldHint`) so a client can tell at a glance which calls
only read state and which can disrupt it — e.g. `run_ssh`, `wp`, `docker_restart`
and `mysql_query` are flagged **destructive**, while `site_status`, `wp_health`
and `cf_dns_list` are **read-only**.

### Resources & prompts

Beyond tools, the server exposes:

- **Resources** — `fleet://config` (a redacted snapshot of which integrations are
  configured, no secrets) and `fleet://setup` (the annotated `.env.example`). Read
  these to discover what the server can currently do.
- **Prompts** — `audit-site` and `install-ojs-journal`: parameterised, reusable
  workflows your client can surface as slash-commands.

### First run / troubleshooting

Run **`fleet_doctor`** before anything else. It reports which local CLIs are
installed, which integrations are configured, and whether the fleet SSH target is
reachable — turning "a tool failed for some reason" into a clear checklist.

## Setup

```bash
cd fleet-mcp
npm install
cp .env.example .env   # then fill in your values
npm run build
```

Requirements on the machine that runs the server:

- **Node ≥ 18** (uses global `fetch`; `--env-file` needs Node ≥ 20.6).
- **ssh** with key auth to the fleet server (recommended over passwords).
- **curl**, **openssl** for the site/SSL tools.
- **gh** CLI for GitHub tools (run `gh auth login` once, or set `GITHUB_TOKEN`).
- **docker** locally, or set `DOCKER_SSH_TARGET` to run it over SSH.

## Register with Claude Code

The easiest way to pass all the credentials is Node's `--env-file`:

```bash
claude mcp add fleet-mcp -- \
  node --env-file=/absolute/path/to/fleet-mcp/.env \
       /absolute/path/to/fleet-mcp/dist/server.js
```

Then in Claude:

- "Check status of example.com, blog.example.com and shop.example.com"
- "How many days until the SSL cert for journal.example.com expires?"
- "List active plugins on shop.example.com and purge its LiteSpeed cache"
- "Show DNS records for example.org on the secondary Cloudflare account"
- "Back up the myapp_db database"

## Installing an OJS journal

`ojs_install` runs your proven recipe end-to-end on an **existing** Plesk
subdomain (deploy files → create DB+user → CLI install → fix
`allowed_hosts`/`base_url`/`trust_x_forwarded_for` → perms → PHP handler) and
returns the generated admin + DB credentials. Prerequisites: the subdomain, its
docroot and DNS already exist (use `cf_dns_add` + Plesk for those first).

> "Install an OJS journal on journal.example.com, create the journal too,
> English name 'New Journal', Arabic 'مجلة جديدة', acronym NJ"

It can optionally create the first journal in the same run (`createJournal`),
applying the three known CLI gotchas (loadAllPlugins throw, missing default
section, per-context theme enable) so the public frontend works immediately.
`ojs_create_journal` does just the journal step on an existing install.

## Dev tools (TypeScript / Go / Next.js)

- `dev_check` — auto-detects the stack and runs vet/build/test (Go) or
  install/tsc/lint/build/test (Node/TS).
- `scaffold_nextjs`, `scaffold_go`, `scaffold_ts_lib` — new project skeletons.
- `dockerize` — writes a production multi-stage Dockerfile, ready to build with
  `docker_*` and deploy with `coolify_*`.

## Running on a domain for your team (remote mode)

The same tools can run as a shared HTTP server behind a domain:

```bash
export MCP_AUTH_TOKEN="$(openssl rand -hex 32)"   # shared team secret
npm run build && npm run start:http               # serves POST /mcp on :8787
```

Or via the included [Dockerfile](Dockerfile) — deploy it on your Coolify host,
put it behind `mcp.example.com` (Cloudflare proxied, Full), and have each
teammate add it as a remote MCP server with the bearer token:

```bash
claude mcp add --transport http fleet-mcp https://mcp.example.com/mcp \
  --header "Authorization: Bearer <MCP_AUTH_TOKEN>"
```

Security: HTTP mode refuses to start without `MCP_AUTH_TOKEN`. Anyone with the
token can run every tool (including `run_ssh`) — treat it like a root password,
keep the endpoint Cloudflare-proxied, and rotate the token to revoke access. The
HTTP transport sets security headers ([helmet](https://helmetjs.github.io/)),
compares the bearer token in **constant time**, and rate-limits requests per IP
(`MCP_RATE_LIMIT_PER_MINUTE`, default 120) to blunt token brute-forcing.

## Configuration

All config is via environment variables — see [.env.example](.env.example). Nothing
is required at startup; each tool validates its own settings when first called, so
you can enable integrations one at a time.

## Safety notes

- `run_ssh` and `mysql_query` (with `allowWrite=true`) can change server state.
  `mysql_query` is **read-only by default** and blocks write/DDL statements unless
  you explicitly opt in.
- **Inputs are validated and escaped.** Hostnames, DB/user identifiers and paths
  are constrained to safe character sets at the tool boundary, and values that
  reach a shell or SQL context are quoted/escaped (`shellQuote` / `sqlStringLiteral`)
  — so a value built from untrusted data can't break out into command or SQL
  injection on the server.
- Secrets live only in `.env` (git-ignored) — never hardcoded. Prefer SSH **key**
  auth and scoped **Cloudflare API tokens** (not the global key).
- Some integrations have official MCP servers too (GitHub, Docker). This unified
  server trades that for one place to manage your whole fleet; swap individual
  groups out later if you prefer the official ones.

## Development

```bash
npm install
npm run typecheck      # tsc --noEmit
npm run lint           # eslint
npm run format         # prettier --write
npm test               # vitest (unit + in-memory integration)
npm run test:coverage  # vitest with coverage thresholds
```

Tests live in [`test/`](test/) and cover the validation/escaping helpers, config
parsing, response shaping and the OJS script builders, plus an **in-memory
integration test** that connects a real MCP client to the server and exercises
every tool, resource and prompt (with the command/HTTP layers mocked). CI runs
all of the above on Node 20 & 22 — see [.github/workflows/ci.yml](.github/workflows/ci.yml).

## Project layout

```
src/
  createServer.ts    # builds + registers every tool group (transport-agnostic)
  server.ts          # local entry point (stdio)
  http.ts            # remote entry point (Streamable HTTP + helmet + rate limit)
  config.ts          # env-based config, validated + lazy require* helpers
  lib/
    exec.ts          # safe local + SSH command execution
    result.ts        # MCP response helpers + error wrapper
    validate.ts      # input schemas + shell/SQL escaping
    annotations.ts   # reusable tool-annotation presets
    auth.ts          # constant-time bearer-token comparison
    version.ts       # name + version (read from package.json)
    creds.ts         # crypto-random passwords + label helpers
    cloudflare.ts    # CF API client
    coolify.ts       # Coolify API client
    ojs-scripts.ts   # OJS install + journal-creation script builders
  tools/
    ssh.ts  sites.ts  wordpress.ts  cloudflare.ts  mysql.ts
    github.ts  docker.ts  coolify.ts  ojs.ts  dev.ts  doctor.ts
  resources/index.ts # fleet://config + fleet://setup
  prompts/index.ts   # audit-site + install-ojs-journal
test/                # vitest unit + in-memory integration tests
```

Add a tool by extending the relevant `tools/*.ts` file (or add a new one and call
its `register*` from `createServer.ts`). Give it an annotation preset from
`lib/annotations.ts` and validate its inputs with the schemas in `lib/validate.ts`.
