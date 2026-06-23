# fleet-mcp

A single MCP server that bundles the tools you use every day to run your hosting
fleet — **SSH/Plesk, WordPress (wp-cli), Cloudflare, MySQL, GitHub, Docker, and
Coolify** — so you can drive all of it from Claude with plain language.

## Tools

| Group | Tools |
|-------|-------|
| **SSH** | `run_ssh` |
| **Sites** | `site_status`, `check_all_sites`, `ssl_expiry`, `disk_usage` |
| **WordPress** | `wp`, `wp_update_plugins`, `wp_purge_lscache`, `wp_health`, `wp_php_handler` |
| **Cloudflare** | `cf_zone_status`, `cf_dns_list`, `cf_dns_add`, `cf_toggle_proxy`, `cf_export_records` |
| **MySQL** | `mysql_query`, `mysql_table_sizes`, `mysql_create_user`, `mysql_dump` |
| **GitHub** | `gh`, `gh_pr_list`, `gh_create_issue` |
| **Docker** | `docker_ps`, `docker_logs`, `docker_restart`, `docker_raw` |
| **Coolify** | `coolify_servers`, `coolify_apps`, `coolify_deploy`, `coolify_resources` |
| **OJS** | `ojs_install`, `ojs_create_journal`, `ojs_status` |
| **Dev** | `dev_check`, `scaffold_nextjs`, `scaffold_go`, `scaffold_ts_lib`, `dockerize` |

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
>  English name 'New Journal', Arabic 'مجلة جديدة', acronym NJ"

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
keep the endpoint Cloudflare-proxied, and rotate the token to revoke access.

## Configuration

All config is via environment variables — see [.env.example](.env.example). Nothing
is required at startup; each tool validates its own settings when first called, so
you can enable integrations one at a time.

## Safety notes

- `run_ssh` and `mysql_query` (with `allowWrite=true`) can change server state.
  `mysql_query` is **read-only by default** and blocks write/DDL statements unless
  you explicitly opt in.
- Secrets live only in `.env` (git-ignored) — never hardcoded. Prefer SSH **key**
  auth and scoped **Cloudflare API tokens** (not the global key).
- Some integrations have official MCP servers too (GitHub, Docker). This unified
  server trades that for one place to manage your whole fleet; swap individual
  groups out later if you prefer the official ones.

## Project layout

```
src/
  createServer.ts    # builds + registers every tool group (transport-agnostic)
  server.ts          # local entry point (stdio)
  http.ts            # remote entry point (Streamable HTTP + bearer auth)
  config.ts          # env-based config + lazy require* helpers
  lib/
    exec.ts          # safe local + SSH command execution
    result.ts        # MCP response helpers + error wrapper
    creds.ts         # crypto-random passwords + label helpers
    cloudflare.ts    # CF API client
    coolify.ts       # Coolify API client
    ojs-scripts.ts   # OJS install + journal-creation script builders
  tools/
    ssh.ts  sites.ts  wordpress.ts  cloudflare.ts  mysql.ts
    github.ts  docker.ts  coolify.ts  ojs.ts  dev.ts
```

Add a tool by extending the relevant `tools/*.ts` file (or add a new one and call
its `register*` from `server.ts`).
