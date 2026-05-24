# Multi-target Dockerfile — one build context, five service runtime stages.
# Pick the stage with `docker-compose build --target <name>` or the `target:`
# key in docker-compose.yml.
#
# Stages: allocator | indexer | agent-hermes | agent-pythia | agent-demeter
#
# Node 22 alpine ships node:sqlite (≥22.5). We install build tools for
# keccak's native addon (used by ethers/hardhat). pnpm via corepack.

# ---------------------------------------------------------------------------
# base — install all workspace deps and compile contracts so ABIs are synced
# ---------------------------------------------------------------------------
FROM node:22-alpine AS base

# Tools needed by `keccak` native build + hardhat compile
RUN apk add --no-cache python3 make g++ git

RUN corepack enable && corepack prepare pnpm@11.2.2 --activate

WORKDIR /app

# Manifests first (best layer cache)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/contracts/package.json apps/contracts/
COPY apps/allocator/package.json apps/allocator/
COPY apps/indexer/package.json apps/indexer/
COPY apps/agent-hermes/package.json apps/agent-hermes/
COPY apps/agent-pythia/package.json apps/agent-pythia/
COPY apps/agent-demeter/package.json apps/agent-demeter/
COPY apps/dashboard/package.json apps/dashboard/
COPY packages/shared/package.json packages/shared/
COPY packages/hl-client/package.json packages/hl-client/

RUN pnpm install --frozen-lockfile

# Source
COPY apps apps
COPY packages packages
COPY scripts scripts

# Compile contracts and populate packages/shared/src/abis/*.json
RUN pnpm --filter @themis/contracts build && pnpm tsx scripts/sync-abis.ts

# Drop root for runtime
RUN addgroup -S themis && adduser -S themis -G themis

# ---------------------------------------------------------------------------
# Service runtime stages — each one is `base` + a different WORKDIR / CMD
# ---------------------------------------------------------------------------

FROM base AS allocator
USER themis
WORKDIR /app/apps/allocator
EXPOSE 3001
CMD ["pnpm", "start"]

FROM base AS indexer
USER themis
WORKDIR /app/apps/indexer
EXPOSE 3002
CMD ["pnpm", "start"]

FROM base AS agent-hermes
USER themis
WORKDIR /app/apps/agent-hermes
CMD ["pnpm", "start"]

FROM base AS agent-pythia
USER themis
WORKDIR /app/apps/agent-pythia
CMD ["pnpm", "start"]

FROM base AS agent-demeter
USER themis
WORKDIR /app/apps/agent-demeter
CMD ["pnpm", "start"]
