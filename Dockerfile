# syntax=docker/dockerfile:1
# Image for running fleet-mcp as a remote (HTTP) MCP server for the team.
FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# Runtime CLIs the tools shell out to (ssh, curl, openssl, git, mysql client).
# gh/docker are optional — install them too if you use those tool groups.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssh-client curl openssl ca-certificates git default-mysql-client python3 \
 && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist

EXPOSE 8787
CMD ["node", "dist/http.js"]
