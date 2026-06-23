#!/usr/bin/env node
// Local entry point — stdio transport for Claude Code / Claude Desktop.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./createServer.js";

const server = createServer();
const transport = new StdioServerTransport();
await server.connect(transport);

// IMPORTANT: stdout is reserved for the MCP protocol — only log to stderr.
console.error("fleet-mcp running on stdio");
