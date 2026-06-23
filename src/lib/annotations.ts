// Reusable MCP tool-annotation presets.
//
// Annotations are *hints* (the MCP spec is explicit that clients must not make
// security decisions from them) but they materially help a model reason about a
// tool: which calls are safe to retry, which only read state, and which can
// disrupt a running system. We classify every fleet-mcp tool with one of these.
//
// Semantics (per the MCP spec):
//  - readOnlyHint   : the tool does not modify its environment.
//  - destructiveHint : (only meaningful when not read-only) the tool may delete,
//                      overwrite, restart or otherwise disrupt existing state.
//  - idempotentHint  : repeating the call with the same args has no extra effect.
//  - openWorldHint   : the tool touches systems outside this process (network,
//                      remote hosts, package registries).

import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

/** Inspects state only; never mutates. Most also reach the network/remote host. */
export const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  openWorldHint: true,
};

/** Creates/changes state but does not delete or overwrite existing data. */
export const WRITE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

/** Like WRITE, but repeating with the same args converges to the same state. */
export const IDEMPOTENT_WRITE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

/** May delete, overwrite, restart or run arbitrary commands. Handle with care. */
export const DESTRUCTIVE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};
