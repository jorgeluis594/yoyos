import { afterAll, expect, test, vi } from "vitest";
import express from "express";
import { err } from "@shared/functional";

const resolveCurrentAccess = vi.hoisted(() => vi.fn());
vi.mock("@core/src/shared/infrastructure/current-user", () => ({ resolveCurrentAccess }));
import { loadApiAccess } from "@core/src/shared/infrastructure/api-auth-middleware";

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
