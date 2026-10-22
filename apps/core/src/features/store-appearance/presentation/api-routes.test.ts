import express from "express";
import { afterEach, expect, test, vi } from "vitest";
import { ok, err } from "@shared/functional";
import type { AddressInfo } from "node:net";

const companyId = "3f1c1d36-7a31-4f7c-9c02-5b0a6a3a1111";
const userId = "3f1c1d36-7a31-4f7c-9c02-5b0a6a3a2222";
const logoId = "3f1c1d36-7a31-4f7c-9c02-5b0a6a3a3333";
const get = vi.fn();
const save = vi.fn();
vi.mock("@core/src/features/store-appearance/composition", () => ({ storeAppearance: { get, save } }));
const { storeAppearanceRoutes } = await import("@core/src/features/store-appearance/presentation/api-routes");

const servers: { close: () => void }[] = [];
async function call(method: "GET" | "PUT", body?: string, contentType = "application/json") {
  const app = express();
  app.use(express.json());
  app.use((_request, response, next) => { response.locals.auth = { company: { id: companyId }, user: { id: userId } }; next(); });
  app.use("/api/store-appearance", storeAppearanceRoutes());
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  servers.push(server);
  const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/store-appearance`, {
    method, ...(body === undefined ? {} : { headers: { "content-type": contentType }, body }) });
  return { status: response.status, cache: response.headers.get("cache-control"), json: await response.json().catch(() => null) as Record<string, unknown> | null };
}
afterEach(() => { servers.splice(0).forEach((server) => server.close()); vi.resetAllMocks(); });

test("GET answers the theme and the logo with its url", async () => {
  get.mockResolvedValue(ok({ kind: "readable", appearance: { theme: "suave", logoImageId: logoId }, logoUrl: "https://cdn.test/logo.png" }));
  const result = await call("GET");
  expect(result.status).toBe(200);
  expect(result.cache).toBe("no-store");
  expect(result.json).toEqual({ kind: "readable", appearance: { theme: "suave", logo: { id: logoId, url: "https://cdn.test/logo.png" } } });
});

test("GET answers unknown_theme as a success and an invalid row as 503 INVALID_STORED_DATA", async () => {
  get.mockResolvedValueOnce(ok({ kind: "unknown_theme" }));
  expect((await call("GET")).json).toEqual({ kind: "unknown_theme" });
  get.mockResolvedValueOnce(err({ code: "INVALID_STORED_DATA", message: "x" }));
  const invalid = await call("GET");
  expect([invalid.status, invalid.json?.code]).toEqual([503, "INVALID_STORED_DATA"]);
});

test("PUT keeps the logo id with a null url when the url cannot be built", async () => {
  save.mockResolvedValue(ok({ appearance: { theme: "classic", logoImageId: logoId }, logoUrl: null }));
  const result = await call("PUT", JSON.stringify({ theme: "classic", logoImageId: logoId }));
  expect(result.status).toBe(200);
  expect(result.json).toEqual({ kind: "readable", appearance: { theme: "classic", logo: { id: logoId, url: null } } });
  expect(save).toHaveBeenCalledWith(companyId, userId, { theme: "classic", logoImageId: logoId });
});

test("PUT rejects an unknown theme, an extra key and a bad id with 400 INVALID_STORE_APPEARANCE without saving", async () => {
  for (const body of [{ theme: "rojo", logoImageId: null }, { theme: "suave", logoImageId: null, color: "#fff" }, { theme: "suave", logoImageId: "nope" }]) {
    const result = await call("PUT", JSON.stringify(body));
    expect([result.status, result.json?.code]).toEqual([400, "INVALID_STORE_APPEARANCE"]);
  }
  expect(save).not.toHaveBeenCalled();
});

test("PUT answers 415 without a JSON content type and 422 INVALID_IMAGE for a logo that is not the company's", async () => {
  expect((await call("PUT", "theme=suave", "text/plain")).status).toBe(415);
  save.mockResolvedValue(err({ code: "INVALID_IMAGE", message: "x" }));
  const result = await call("PUT", JSON.stringify({ theme: "suave", logoImageId: logoId }));
  expect([result.status, result.json?.code]).toEqual([422, "INVALID_IMAGE"]);
});

test("PUT answers 503 SERVICE_UNAVAILABLE when persistence fails and 500 when the use case throws", async () => {
  save.mockResolvedValueOnce(err({ code: "PERSISTENCE_UNAVAILABLE", message: "x" }));
  const body = JSON.stringify({ theme: "suave", logoImageId: null });
  const down = await call("PUT", body);
  expect([down.status, down.json?.code]).toEqual([503, "SERVICE_UNAVAILABLE"]);
  save.mockRejectedValueOnce(new Error("boom"));
  expect((await call("PUT", body)).status).toBe(500);
});
