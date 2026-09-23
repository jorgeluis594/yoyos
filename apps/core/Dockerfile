FROM node:24-alpine

WORKDIR /workspace/apps/core

RUN apk add --no-cache postgresql-client

RUN corepack enable && corepack prepare pnpm@12.5.1 --activate

COPY apps/core/package.json apps/core/pnpm-lock.yaml apps/core/pnpm-workspace.yaml ./
COPY apps/core/prisma ./prisma
COPY apps/core/prisma.config.ts ./
RUN pnpm install --frozen-lockfile

COPY apps/core/. .

EXPOSE 3000
