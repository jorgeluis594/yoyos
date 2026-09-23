import express from "express";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./shared/infrastructure/auth.js";
import { resolveCurrentUser } from "./shared/infrastructure/current-user.js";
import { createCompanyForUser, withTenantIsolation } from "./shared/infrastructure/persistance.js";

export const app = express();

app.all("/api/auth/{*splat}", toNodeHandler(auth));

app.use("/api", express.json());

app.post("/api/company", async (request, response) => {
  const user = await resolveCurrentUser(new Headers(request.headers as HeadersInit));
  if (!user) return response.status(401).json({ error: "Unauthorized" });
  if (user.companyId) return response.status(200).json({ companyId: user.companyId });
  const name = typeof request.body?.name === "string" ? request.body.name.trim() : "";
  if (name.length < 1 || name.length > 120) return response.status(400).json({ error: "Name must have 1 to 120 characters" });
  const result = await createCompanyForUser(user.id, name);
  return response.status(result.created ? 201 : 200).json({ companyId: result.companyId });
});

app.use("/api", async (request, response, next) => {
  const user = await resolveCurrentUser(new Headers(request.headers as HeadersInit));
  if (!user) return response.status(401).json({ error: "Unauthorized" });
  if (!user.companyId) return response.status(409).json({ error: "Company required" });
  return withTenantIsolation(user.companyId, next);
});

app.use("/api", (_request, response) => {
  response.status(404).json({ error: "Not found" });
});

app.use("/webhooks", express.raw({ type: "*/*" }), (_request, response) => {
  response.sendStatus(404);
});
