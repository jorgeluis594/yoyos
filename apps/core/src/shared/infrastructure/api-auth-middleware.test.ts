import { afterAll, expect, test, vi } from "vitest";
import express from "express";
import { err, ok } from "@shared/functional";

const resolveCurrentAccess = vi.hoisted(() => vi.fn());
vi.mock("@core/src/shared/infrastructure/current-user", () => ({ resolveCurrentAccess }));
vi.mock("@core/src/shared/infrastructure/persistance", () => ({ withTenantIsolation: (_companyId: string, next: () => void) => next() }));
import { loadApiAccess, requireApiCompany } from "@core/src/shared/infrastructure/api-auth-middleware";

const app = express();
app.use(loadApiAccess);
app.get("/api/me", (_request, response) => response.json({ unexpected: true }));
const server = app.listen(0);
afterAll(() => server.close());

test.each([
  ["UNAUTHENTICATED", 401, "UNAUTHENTICATED"],
  ["AUTH_SERVICE_UNAVAILABLE", 503, "SERVICE_UNAVAILABLE"],
  ["PERSISTENCE_UNAVAILABLE", 503, "SERVICE_UNAVAILABLE"],
  ["INVALID_STORED_DATA", 500, "INTERNAL_ERROR"],
] as const)("maps %s without treating infrastructure failure as missing session", async (source, status, code) => {
  resolveCurrentAccess.mockResolvedValueOnce(err({ code: source, message: "private detail" }));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server has no port");
  const response = await fetch(`http://127.0.0.1:${address.port}/api/me`);
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ code, error: expect.any(String) });
});

test("keeps the session id in response.locals.auth after the company requirement", async () => {
  const company = { id: "7d3c2a9e-0f43-4c61-9f0e-2d1b8a5c6e11", name: "Shop", country: "PE" };
  resolveCurrentAccess.mockResolvedValueOnce(ok({ status: "ready", sessionId: "sid-1", company,
    user: { id: "user-1", name: "Seller", emailVerified: true, companyId: company.id } }));
  const sessionApp = express();
  sessionApp.use(loadApiAccess, requireApiCompany);
  sessionApp.get("/api/session", (_request, response) => response.json({ sessionId: response.locals.auth.sessionId }));
  const sessionServer = sessionApp.listen(0);
  try {
    const address = sessionServer.address();
    if (!address || typeof address === "string") throw new Error("Test server has no port");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/session`);
    expect(await response.json()).toEqual({ sessionId: "sid-1" });
  } finally { sessionServer.close(); }
});
