import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config } from "../config.js";
import { runRemote } from "../lib/exec.js";
import { fromExec, errorText, safe } from "../lib/result.js";
import {
  identifierSchema,
  dbHostSchema,
  absolutePathSchema,
  shellQuote,
  sqlStringLiteral,
} from "../lib/validate.js";
import { READ_ONLY, IDEMPOTENT_WRITE, DESTRUCTIVE } from "../lib/annotations.js";

export const WRITE_RE =
  /\b(insert|update|delete|drop|alter|create|truncate|replace|grant|revoke|rename|set)\b/i;

/** Build the auth fragment for mysql/mysqldump CLI invocations. */
function authArgs(): string {
  const parts: string[] = [];
  if (config.mysql.user) parts.push(`-u${shellQuote(config.mysql.user)}`);
  if (config.mysql.password) parts.push(`-p${shellQuote(config.mysql.password)}`);
  return parts.join(" ");
}

/** Pipe SQL into mysql via base64 to avoid all shell-quoting hazards. */
function pipeSql(db: string, sql: string, table = true): string {
  const b64 = Buffer.from(sql, "utf8").toString("base64");
  const flags = table ? "--table" : "--batch";
  return `echo ${b64} | base64 -d | mysql ${authArgs()} ${flags} ${shellQuote(db)}`;
}

export function registerMysql(server: McpServer) {
  server.registerTool(
    "mysql_query",
    {
      title: "Run SQL query",
      description:
        "Run SQL against a database on the fleet server over SSH. Read-only by " +
        "default — write statements are blocked unless allowWrite is true.",
      inputSchema: {
        database: identifierSchema.describe("Database name"),
        sql: z.string().min(1).describe("SQL statement(s) to run"),
        allowWrite: z
          .boolean()
          .default(false)
          .describe("Set true to permit INSERT/UPDATE/DELETE/DDL — use with care"),
      },
      annotations: DESTRUCTIVE,
    },
    safe(async ({ database, sql, allowWrite }) => {
      if (!allowWrite && WRITE_RE.test(sql)) {
        return errorText(
          "Blocked: this looks like a write/DDL statement. Re-run with allowWrite=true if intended."
        );
      }
      return fromExec(await runRemote(pipeSql(database, sql)));
    })
  );

  server.registerTool(
    "mysql_table_sizes",
    {
      title: "Table sizes",
      description: "List tables in a database ordered by size (MB), with row counts.",
      inputSchema: { database: identifierSchema.describe("Database name") },
      annotations: READ_ONLY,
    },
    safe(async ({ database }) => {
      // `database` is validated to [A-Za-z0-9_]; safe to embed as a SQL literal.
      const sql = `SELECT table_name AS tbl, ROUND(((data_length+index_length)/1024/1024),2) AS mb, table_rows AS rows_est FROM information_schema.tables WHERE table_schema=${sqlStringLiteral(database)} ORDER BY (data_length+index_length) DESC;`;
      return fromExec(await runRemote(pipeSql("information_schema", sql)));
    })
  );

  server.registerTool(
    "mysql_create_user",
    {
      title: "Create DB user + grant",
      description:
        "Create a MySQL user (if absent) and grant all privileges on one database. " +
        "Useful when a migrated site has a DB but no registered user.",
      inputSchema: {
        database: identifierSchema.describe("Database to grant on"),
        user: identifierSchema.describe("New username"),
        password: z.string().min(1).describe("Password for the new user"),
        host: dbHostSchema.default("localhost").describe("Allowed host"),
      },
      annotations: IDEMPOTENT_WRITE,
    },
    safe(async ({ database, user, password, host }) => {
      const sql = [
        `CREATE USER IF NOT EXISTS ${sqlStringLiteral(user)}@${sqlStringLiteral(host)} IDENTIFIED BY ${sqlStringLiteral(password)};`,
        `GRANT ALL PRIVILEGES ON \\\`${database}\\\`.* TO ${sqlStringLiteral(user)}@${sqlStringLiteral(host)};`,
        `FLUSH PRIVILEGES;`,
      ].join(" ");
      const r = await runRemote(pipeSql("mysql", sql, false));
      return r.code === 0
        ? fromExec({ ...r, stdout: `Granted ${user}@${host} on ${database}` })
        : fromExec(r);
    })
  );

  server.registerTool(
    "mysql_dump",
    {
      title: "Backup database",
      description: "Dump a database to a timestamped gzip file on the server and return its path.",
      inputSchema: {
        database: identifierSchema.describe("Database name"),
        dir: absolutePathSchema
          .default("/root/backups")
          .describe("Destination directory on the server"),
      },
      annotations: IDEMPOTENT_WRITE,
    },
    safe(async ({ database, dir }) => {
      const qdir = shellQuote(dir);
      const cmd =
        `mkdir -p ${qdir} && ` +
        `mysqldump ${authArgs()} ${shellQuote(database)} | gzip > ${qdir}/${database}-$(date +%F-%H%M%S).sql.gz && ` +
        `ls -lh ${qdir}/${database}-*.sql.gz | tail -1`;
      return fromExec(await runRemote(cmd));
    })
  );
}
