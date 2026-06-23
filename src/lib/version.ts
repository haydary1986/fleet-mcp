// Single source of truth for the server name + version, read from package.json
// at runtime so it never drifts from the published package. Works both when run
// from dist/ (compiled) and from src/ via tsx.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

function readVersion(): string {
  // dist/lib/version.js -> ../../package.json ; src/lib/version.ts -> ../../package.json
  for (const rel of ["../../package.json", "../package.json"]) {
    try {
      const pkg = JSON.parse(readFileSync(join(here, rel), "utf8"));
      if (typeof pkg.version === "string") return pkg.version;
    } catch {
      // try the next candidate
    }
  }
  return "0.0.0";
}

export const NAME = "fleet-mcp";
export const VERSION = readVersion();
