import { createRequestHandler } from "@react-router/express";
import express from "express";
import { app } from "./app.js";
import { logger } from "@core/src/shared/infrastructure/logger";
import { createEventBusRuntime } from "@core/src/composition/event-bus";

const port = Number(process.env.PORT ?? 3000);
const build = await import(new URL("../build/server/index.js", import.meta.url).href);
const { provider } = createEventBusRuntime();
await provider.start();

app.use(express.static("build/client", { index: false }));
app.all(
  "/{*splat}",
  createRequestHandler({ build, mode: process.env.NODE_ENV }),
);

const server = app.listen(port, () => logger.info({ event: "server_started", port }, "Core listening"));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  server.close(async () => {
    await provider.stop();
    process.exit(0);
  });
});
