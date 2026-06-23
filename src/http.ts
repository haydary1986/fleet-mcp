#!/usr/bin/env node
// Remote entry point — Streamable HTTP transport for team use behind a domain.
// Stateless mode: each request gets a fresh server+transport, so many clients
// can connect concurrently. Protected by a bearer token (MCP_AUTH_TOKEN).
import express, { type Request, type Response, type NextFunction } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./createServer.js";
import { config } from "./config.js";
import { NAME } from "./lib/version.js";
import { safeTokenEquals, bearerToken } from "./lib/auth.js";

const app = express();
// Security headers (no need for a referrer/CSP on a JSON API; helmet defaults are fine).
app.use(helmet());
app.use(express.json({ limit: "4mb" }));

// Per-IP rate limit to blunt brute-force against the bearer token.
const limiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "rate limit exceeded" },
});
app.use(limiter);

// Unauthenticated health check (for Traefik/Coolify/uptime probes).
app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, name: NAME });
});

// Bearer-token auth for everything else (constant-time compare — no length/byte leak).
app.use((req: Request, res: Response, next: NextFunction) => {
  if (!config.http.authToken) {
    res.status(500).json({ error: "MCP_AUTH_TOKEN is not set — refusing to serve unauthenticated" });
    return;
  }
  const token = bearerToken(req.headers.authorization);
  if (!safeTokenEquals(token, config.http.authToken)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
});

app.post("/mcp", async (req: Request, res: Response) => {
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: String(err) });
    }
  }
});

// Stateless mode does not use GET (SSE stream) or DELETE (session teardown).
const methodNotAllowed = (_req: Request, res: Response) =>
  res.status(405).json({ error: "Method Not Allowed (stateless server)" });
app.get("/mcp", methodNotAllowed);
app.delete("/mcp", methodNotAllowed);

app.listen(config.http.port, () => {
  console.error(`fleet-mcp HTTP transport listening on :${config.http.port} (POST /mcp)`);
});
