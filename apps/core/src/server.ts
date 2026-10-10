import { createRequestHandler } from "@react-router/express";
import express from "express";
import { pathToFileURL } from "node:url";
import { app } from "@core/src/app";
import { log } from "@core/src/shared/infrastructure/logger";
import { applicationEventBus } from "@core/src/composition/event-bus";

export async function startServer() {
  const port = Number(process.env.PORT ?? 3000);
  const build = await import(new URL("../build/server/index.js", import.meta.url).href);
  const { provider } = applicationEventBus();
  await provider.start();
  app.use(express.static("build/client", { index: false }));
  app.all("/{*splat}", createRequestHandler({ build, mode: process.env.NODE_ENV,
    getLoadContext: () => build.entry.module.createRequestContext(),
  }));
  const server = app.listen(port, () => log.info({ event: "server_started", port }, "Core listening"));
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
    server.close(async () => { await provider.stop(); process.exit(0); });
  });
  return server;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await startServer();
