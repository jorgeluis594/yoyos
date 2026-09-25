import { createRequestHandler } from "@react-router/express";
import express from "express";
import { app } from "./app.js";
import { loadWhatsAppConnections } from "@core/src/features/chats/infrastructure/whatsapp-connections";
import { startImageWorker } from "@core/src/features/chats/infrastructure/image-worker-loop";

const port = Number(process.env.PORT ?? 3000);
const build = await import(new URL("../build/server/index.js", import.meta.url).href);

app.use(express.static("build/client", { index: false }));
app.all(
  "/{*splat}",
  createRequestHandler({ build, mode: process.env.NODE_ENV }),
);

const stopImageWorker = startImageWorker(loadWhatsAppConnections());
const server = app.listen(port, () => console.log(`Core listening on http://localhost:${port}`));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  stopImageWorker();
  server.close(() => process.exit(0));
});
