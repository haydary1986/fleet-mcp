import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerSsh } from "./tools/ssh.js";
import { registerSites } from "./tools/sites.js";
import { registerWordpress } from "./tools/wordpress.js";
import { registerCloudflare } from "./tools/cloudflare.js";
import { registerMysql } from "./tools/mysql.js";
import { registerGithub } from "./tools/github.js";
import { registerDocker } from "./tools/docker.js";
import { registerCoolify } from "./tools/coolify.js";
import { registerOjs } from "./tools/ojs.js";
import { registerDev } from "./tools/dev.js";
import { registerPlesk } from "./tools/plesk.js";

/** Build a fully-configured MCP server. Transport-agnostic — used by both the
 *  stdio (local) and Streamable HTTP (remote/team) entry points. */
export function createServer(): McpServer {
  const server = new McpServer({ name: "fleet-mcp", version: "1.0.0" });

  registerSsh(server);
  registerSites(server);
  registerWordpress(server);
  registerCloudflare(server);
  registerMysql(server);
  registerGithub(server);
  registerDocker(server);
  registerCoolify(server);
  registerOjs(server);
  registerDev(server);
  registerPlesk(server);

  return server;
}
