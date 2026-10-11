import { afterEach, expect, test, vi } from "vitest";
import type { Server } from "node:http";

vi.mock("@core/src/shared/infrastructure/api-auth-middleware", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@core/src/shared/infrastructure/api-auth-middleware")>()),
  loadApiAccess: (_request: unknown, _response: unknown, next: () => void) => next(),
  requireApiCompany: (_request: unknown, _response: unknown, next: () => void) => next(),
}));

import { app } from "@core/src/app";

const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))); });

async function baseUrl() {
  const server = app.listen(0);
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  return `http://127.0.0.1:${address.port}`;
}

test("POST /api/whatsapp/messages returns 404", async () => {
  const response = await fetch(`${await baseUrl()}/api/whatsapp/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  expect(response.status).toBe(404);
});

test("GET /api/messages falls through to the generic /api 404", async () => {
  const response = await fetch(`${await baseUrl()}/api/messages`);
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ code: "NOT_FOUND", error: "Not found" });
});
