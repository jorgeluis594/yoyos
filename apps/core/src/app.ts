import express from "express";
import { toNodeHandler } from "better-auth/node";
import { isCountry } from "@shared/country";
import { createCompanyForUser } from "@core/src/features/companies/application/create-company-for-user";
import { companyRepository } from "@core/src/features/companies/infrastructure/company-repository";
import { auth } from "./shared/infrastructure/auth.js";
import { resolveCurrentUser } from "./shared/infrastructure/current-user.js";
import { withTenantIsolation } from "./shared/infrastructure/persistance.js";
import { imageRoutes } from "@core/src/shared/images/presentation/routes";
import { imageRepository } from "@core/src/shared/images/infrastructure/image-repository";
import { createCloudflareImageStorage } from "@core/src/shared/images/infrastructure/cloudflare-image-storage";

export const app = express();

app.all("/api/auth/{*splat}", toNodeHandler(auth));

app.use("/api", express.json());

app.post("/api/company", async (request, response) => {
  const user = await resolveCurrentUser(new Headers(request.headers as HeadersInit));
  if (!user) return response.status(401).json({ error: "Unauthorized" });
  const name = typeof request.body?.name === "string" ? request.body.name.trim() : "";
  if (name.length < 1 || name.length > 120) return response.status(400).json({ error: "Name must have 1 to 120 characters" });
  const country = request.body?.country;
  if (!isCountry(country)) return response.status(400).json({ error: "Unsupported country" });
  const result = await createCompanyForUser(user.id, name, country, companyRepository);
  return response.status(result.created ? 201 : 200).json({ companyId: result.companyId });
});

app.use("/api", async (request, response, next) => {
  const user = await resolveCurrentUser(new Headers(request.headers as HeadersInit));
  if (!user) return response.status(401).json({ error: "Unauthorized" });
  if (!user.companyId) return response.status(409).json({ error: "Company required" });
  return withTenantIsolation(user.companyId, next);
});

app.use("/api/images", imageRoutes(createCloudflareImageStorage({
  accountId: process.env.CLOUDFLARE_IMAGES_ACCOUNT_ID ?? "",
  apiToken: process.env.CLOUDFLARE_IMAGES_API_TOKEN ?? "",
  deliveryHash: process.env.CLOUDFLARE_IMAGES_DELIVERY_HASH ?? "",
}), imageRepository));

app.use("/api", (_request, response) => {
  response.status(404).json({ error: "Not found" });
});

app.use("/webhooks", express.raw({ type: "*/*" }), (_request, response) => {
  response.sendStatus(404);
});
