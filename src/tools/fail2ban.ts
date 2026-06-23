import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runRemote } from "../lib/exec.js";
import { fromExec, safe } from "../lib/result.js";

// Helper bash that lists configured jails, one per line.
const JAILS = `fail2ban-client status | sed -n 's/.*Jail list:[[:space:]]*//p' | tr ',' '\\n' | sed 's/^ *//;s/ *$//'`;

export function registerFail2ban(server: McpServer) {
  server.registerTool(
    "f2b_status",
    {
      title: "fail2ban status",
      description: "Show fail2ban overall status, or a single jail's status (banned IPs, counts).",
      inputSchema: {
        jail: z.string().optional().describe("Jail name, e.g. sshd (omit for overview)"),
      },
    },
    safe(async ({ jail }) =>
      fromExec(await runRemote(jail ? `fail2ban-client status ${jail}` : "fail2ban-client status"))
    )
  );

  server.registerTool(
    "f2b_check_ip",
    {
      title: "Check if IP is banned",
      description: "Check whether an IP is currently banned in any fail2ban jail.",
      inputSchema: { ip: z.string().describe("IP address to check") },
    },
    safe(async ({ ip }) => {
      const cmd = `found=0; for j in $(${JAILS}); do if fail2ban-client status "$j" 2>/dev/null | grep -qw "${ip}"; then echo "BANNED in $j"; found=1; fi; done; [ "$found" = 0 ] && echo "${ip} is not banned in any jail"`;
      return fromExec(await runRemote(cmd));
    })
  );

  server.registerTool(
    "f2b_unban",
    {
      title: "Unban an IP",
      description: "Unban an IP across all jails (or a specific jail).",
      inputSchema: {
        ip: z.string().describe("IP address to unban"),
        jail: z.string().optional().describe("Limit to one jail (default: all)"),
      },
    },
    safe(async ({ ip, jail }) => {
      const cmd = jail
        ? `fail2ban-client set ${jail} unbanip ${ip} 2>&1`
        : `fail2ban-client unban ${ip} 2>&1 || for j in $(${JAILS}); do fail2ban-client set "$j" unbanip ${ip} 2>/dev/null && echo "unbanned in $j"; done`;
      return fromExec(await runRemote(cmd));
    })
  );

  server.registerTool(
    "f2b_ignore_add",
    {
      title: "Add IP to ignore list",
      description:
        "Add an IP to a jail's runtime ignore list so it won't get banned (e.g. your own IP). " +
        "Runtime only — also add it to /etc/fail2ban/jail.local ignoreip for persistence.",
      inputSchema: {
        ip: z.string().describe("IP address to whitelist"),
        jail: z.string().default("sshd").describe("Jail to add the ignore to"),
      },
    },
    safe(async ({ ip, jail }) =>
      fromExec(await runRemote(`fail2ban-client set ${jail} addignoreip ${ip} 2>&1`))
    )
  );
}
