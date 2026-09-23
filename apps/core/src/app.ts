import express from "express";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./shared/infrastructure/auth.js";

export const app = express();

app.all("/api/auth/{*splat}", toNodeHandler(auth));

app.use("/api", express.json(), (_request, response) => {
  response.status(404).json({ error: "Not found" });
});

app.use("/webhooks", express.raw({ type: "*/*" }), (_request, response) => {
  response.sendStatus(404);
});
