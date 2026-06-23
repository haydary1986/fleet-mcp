import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runLocal } from "../lib/exec.js";
import { fromExec, text, safe } from "../lib/result.js";
import { absolutePathSchema, packageNameSchema, goModuleSchema } from "../lib/validate.js";
import { WRITE, IDEMPOTENT_WRITE } from "../lib/annotations.js";

const LONG = 600_000; // installs/builds can be slow

/** Dockerfile templates per stack (base64'd onto disk to avoid quoting issues). */
const DOCKERFILES: Record<string, string> = {
  nextjs: `# syntax=docker/dockerfile:1
# Requires next.config.js: { output: "standalone" }
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
`,
  node: `# syntax=docker/dockerfile:1
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build || echo "no build step"

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app ./
EXPOSE 3000
CMD ["npm", "start"]
`,
  go: `# syntax=docker/dockerfile:1
FROM golang:1.22-alpine AS builder
WORKDIR /src
COPY go.* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /app/server ./...

FROM gcr.io/distroless/static-debian12
COPY --from=builder /app/server /server
EXPOSE 8080
ENTRYPOINT ["/server"]
`,
};

export function registerDev(server: McpServer) {
  server.registerTool(
    "dev_check",
    {
      title: "Build / lint / test a project",
      description:
        "Auto-detect the stack in a directory and run its checks. Go: vet, build, test. " +
        "Node/TS: optional install, then tsc --noEmit, lint, build (whatever exists).",
      inputSchema: {
        path: absolutePathSchema.describe("Absolute path to the project directory"),
        install: z.boolean().default(true).describe("Run npm install first (Node projects)"),
      },
      annotations: IDEMPOTENT_WRITE,
    },
    safe(async ({ path, install }) => {
      const script = `
set +e
if [ -f go.mod ]; then
  echo "== go vet =="; go vet ./... 2>&1
  echo "== go build =="; go build ./... 2>&1
  echo "== go test =="; go test ./... 2>&1
elif [ -f package.json ]; then
  ${install ? 'echo "== npm install =="; (npm ci 2>/dev/null || npm install) 2>&1 | tail -5' : 'echo "(skipping install)"'}
  if [ -f tsconfig.json ]; then echo "== tsc --noEmit =="; npx --yes tsc --noEmit 2>&1; fi
  if npm run 2>/dev/null | grep -q ' lint'; then echo "== lint =="; npm run -s lint 2>&1; fi
  if npm run 2>/dev/null | grep -q ' build'; then echo "== build =="; npm run -s build 2>&1; fi
  if npm run 2>/dev/null | grep -q ' test'; then echo "== test =="; CI=1 npm test 2>&1; fi
else
  echo "No go.mod or package.json found in ${path}"
fi
`;
      return fromExec(await runLocal("bash", ["-lc", script], { cwd: path, timeoutMs: LONG }));
    })
  );

  server.registerTool(
    "scaffold_nextjs",
    {
      title: "Scaffold a Next.js app",
      description:
        "Create a new Next.js app (TypeScript, App Router) via create-next-app in the given directory.",
      inputSchema: {
        name: packageNameSchema.describe("App/folder name"),
        dir: absolutePathSchema.describe("Parent directory to create the app in"),
      },
      annotations: WRITE,
    },
    safe(async ({ name, dir }) =>
      fromExec(
        await runLocal(
          "bash",
          ["-lc", `npx --yes create-next-app@latest ${name} --yes 2>&1 | tail -25`],
          { cwd: dir, timeoutMs: LONG }
        )
      )
    )
  );

  server.registerTool(
    "scaffold_go",
    {
      title: "Scaffold a Go module",
      description: "Create a new Go module with a minimal main.go and verify it builds.",
      inputSchema: {
        name: packageNameSchema.describe("Folder name"),
        module: goModuleSchema.describe("Go module path, e.g. github.com/you/app"),
        dir: absolutePathSchema.describe("Parent directory"),
      },
      annotations: WRITE,
    },
    safe(async ({ name, module, dir }) => {
      const script = `
set -e
mkdir -p ${name} && cd ${name}
go mod init ${module}
cat > main.go <<'EOF'
package main

import "fmt"

func main() {
	fmt.Println("hello from ${module}")
}
EOF
go build ./... && echo "scaffolded ${module} in ${dir}/${name}"
`;
      return fromExec(await runLocal("bash", ["-lc", script], { cwd: dir, timeoutMs: LONG }));
    })
  );

  server.registerTool(
    "scaffold_ts_lib",
    {
      title: "Scaffold a TypeScript library",
      description:
        "Create a minimal strict-TypeScript library (package.json, tsconfig, src/index.ts).",
      inputSchema: {
        name: packageNameSchema.describe("Folder + package name"),
        dir: absolutePathSchema.describe("Parent directory"),
      },
      annotations: WRITE,
    },
    safe(async ({ name, dir }) => {
      const pkg = JSON.stringify(
        {
          name,
          version: "0.1.0",
          type: "module",
          main: "dist/index.js",
          types: "dist/index.d.ts",
          scripts: { build: "tsc", typecheck: "tsc --noEmit" },
          devDependencies: { typescript: "^5.6.3" },
        },
        null,
        2
      );
      const tsconfig = JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "NodeNext",
            moduleResolution: "NodeNext",
            outDir: "dist",
            declaration: true,
            strict: true,
            skipLibCheck: true,
          },
          include: ["src"],
        },
        null,
        2
      );
      const pkgB64 = Buffer.from(pkg).toString("base64");
      const tsB64 = Buffer.from(tsconfig).toString("base64");
      const script = `
set -e
mkdir -p ${name}/src && cd ${name}
echo "${pkgB64}" | base64 -d > package.json
echo "${tsB64}" | base64 -d > tsconfig.json
printf 'export const hello = (name: string): string => \`hello \${name}\`;\\n' > src/index.ts
echo "scaffolded TS library '${name}' in ${dir}/${name}"
`;
      return fromExec(await runLocal("bash", ["-lc", script], { cwd: dir, timeoutMs: LONG }));
    })
  );

  server.registerTool(
    "dockerize",
    {
      title: "Generate a Dockerfile",
      description:
        "Write a production multi-stage Dockerfile into a project. Pairs with the docker_* " +
        "and coolify_* tools to build and deploy the result on your server.",
      inputSchema: {
        path: absolutePathSchema.describe("Project directory to write the Dockerfile into"),
        stack: z.enum(["nextjs", "node", "go"]).describe("Project stack"),
      },
      // Writes a single local file; no network. Repeating yields the same file.
      annotations: { ...IDEMPOTENT_WRITE, openWorldHint: false },
    },
    safe(async ({ path, stack }) => {
      const b64 = Buffer.from(DOCKERFILES[stack]).toString("base64");
      const r = await runLocal(
        "bash",
        [
          "-lc",
          `echo "${b64}" | base64 -d > Dockerfile && echo "wrote Dockerfile (${stack}) to ${path}"`,
        ],
        { cwd: path }
      );
      return r.code === 0
        ? text(`${r.stdout.trim()}\n\n--- Dockerfile ---\n${DOCKERFILES[stack]}`)
        : fromExec(r);
    })
  );
}
