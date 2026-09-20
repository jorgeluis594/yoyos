import { createRequestHandler } from "@react-router/express";
import express from "express";
import { app } from "./app.js";

const port = Number(process.env.PORT ?? 3000);
const build = await import(new URL("../build/server/index.js", import.meta.url).href);

app.use(express.static("build/client", { index: false }));
app.all(
  "/{*splat}",
  createRequestHandler({ build, mode: process.env.NODE_ENV }),
);

app.listen(port, () => console.log(`Core listening on http://localhost:${port}`));
