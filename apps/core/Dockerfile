# Debian slim, not Alpine: onnxruntime-node (local image embedder) ships glibc binaries only.
FROM node:24-slim

WORKDIR /workspace/apps/core

RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@12.5.1 --activate

COPY shared/package.json shared/pnpm-lock.yaml /workspace/shared/
RUN pnpm --dir /workspace/shared install --frozen-lockfile

COPY apps/core/package.json apps/core/pnpm-lock.yaml apps/core/pnpm-workspace.yaml ./
COPY patches /workspace/patches
COPY apps/core/prisma ./prisma
COPY apps/core/prisma.config.ts ./
RUN pnpm install --frozen-lockfile

# Copies apps/core/models too: the local image embedder loads only from there and never downloads (models/README.md).
COPY apps/core/. .
COPY shared /workspace/shared
COPY docs/design-tokens.json /workspace/docs/design-tokens.json

# Prisma config requires DATABASE_URL, but generate never connects.
RUN DATABASE_URL=postgresql://build@localhost/build pnpm exec prisma generate && pnpm build

EXPOSE 3000
