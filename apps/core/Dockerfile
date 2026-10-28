# Debian slim, not Alpine: onnxruntime-node (local image embedder) ships glibc binaries only.
FROM node:24-slim

# Runs as the image's node user, renumbered to the host's uid:gid in development, so files the containers write
# into the bind-mounted source (apps/core/build, node_modules) belong to the host user and git can delete the worktree.
ARG UID=1000
ARG GID=1000

RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client && rm -rf /var/lib/apt/lists/*

ENV COREPACK_HOME=/opt/corepack
RUN corepack enable && corepack prepare pnpm@12.5.1 --activate

RUN groupmod -o -g "$GID" node && usermod -o -u "$UID" -g "$GID" node \
  && mkdir -p /workspace/apps/core && chown -R node:node /workspace /opt/corepack
USER node
WORKDIR /workspace/apps/core

# The local image model is fetched at build from a pinned revision and verified by sha256; the embedder loads only from models/ and never
# downloads at runtime (models/README.md). Before the installs, with plain node (type stripping), so the 372 MB layer stays cached until
# the script changes, not on every dependency or schema change.
COPY --chown=node:node apps/core/scripts/fetch-image-model.ts ./scripts/
RUN node scripts/fetch-image-model.ts

COPY --chown=node:node shared/package.json shared/pnpm-lock.yaml /workspace/shared/
RUN pnpm --dir /workspace/shared install --frozen-lockfile

COPY --chown=node:node apps/core/package.json apps/core/pnpm-lock.yaml apps/core/pnpm-workspace.yaml ./
COPY --chown=node:node patches /workspace/patches
COPY --chown=node:node apps/core/prisma ./prisma
COPY --chown=node:node apps/core/prisma.config.ts ./
RUN pnpm install --frozen-lockfile

COPY --chown=node:node apps/core/. .
COPY --chown=node:node shared /workspace/shared
COPY --chown=node:node docs/design-tokens.json /workspace/docs/design-tokens.json

# Prisma config requires DATABASE_URL, but generate never connects.
RUN DATABASE_URL=postgresql://build@localhost/build pnpm exec prisma generate && pnpm build

EXPOSE 3000
