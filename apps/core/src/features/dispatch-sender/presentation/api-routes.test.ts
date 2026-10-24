import express from "express";
import type { AddressInfo } from "node:net";
import { afterEach, expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";

const companyId = "3f1c1d36-7a31-4f7c-9c02-5b0a6a3a1111";
const userId = "3f1c1d36-7a31-4f7c-9c02-5b0a6a3a2222";
const get = vi.fn();
const save = vi.fn();
vi.mock("@core/src/features/dispatch-sender/composition", () => ({ dispatchSender: { get, save } }));
const { dispatchSenderRoutes } = await import("@core/src/features/dispatch-sender/presentation/api-routes");

const servers: { close: () => void }[] = [];
async function call(method: "GET" | "PUT", body?: string, contentType = "application/json") {
  const app = express();
  app.use(express.json());
  app.use((_request, response, next) => { response.locals.auth = { company: { id: companyId }, user: { id: userId } }; next(); });
  app.use("/api/company/dispatch-sender", dispatchSenderRoutes);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  servers.push(server);
  const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/company/dispatch-sender`, {
    method, ...(body === undefined ? {} : { headers: { "content-type": contentType }, body }) });
  return { status: response.status, json: await response.json().catch(() => null) as Record<string, unknown> | null };
}
afterEach(() => { servers.splice(0).forEach((server) => server.close()); vi.resetAllMocks(); });

const state = { configured: { name: null, phone: "977" }, effective: { name: "Mi Negocio", phone: "977" } };

test("GET answers the configured values and the effective sender of the session company", async () => {
  get.mockResolvedValue(ok(state));
  expect(await call("GET")).toEqual({ status: 200, json: state });
  expect(get).toHaveBeenCalledWith(companyId);
});

test("GET maps storage failures to 503 and other failures to 500", async () => {
  get.mockResolvedValueOnce(err({ code: "PERSISTENCE_UNAVAILABLE", message: "down" }));
  expect((await call("GET")).status).toBe(503);
  get.mockResolvedValueOnce(err({ code: "COMPANY_NOT_FOUND", message: "x" }));
  expect((await call("GET")).status).toBe(500);
});

test("PUT saves the trimmed sender with the company and author taken from the session", async () => {
  save.mockResolvedValue(ok(state));
  const result = await call("PUT", JSON.stringify({ name: "  ", phone: " 977 " }));
  expect(result).toEqual({ status: 200, json: state });
  expect(save).toHaveBeenCalledWith(companyId, userId, { name: null, phone: "977" });
});

test("PUT rejects forged fields, long text, a bad type and a non-JSON body without saving", async () => {
  for (const body of [{ name: null, phone: null, companyId: "forged" }, { name: "n".repeat(121), phone: null }, { name: null, phone: "1".repeat(31) }, { name: 5, phone: null }, { name: null }]) {
    const result = await call("PUT", JSON.stringify(body));
    expect([result.status, result.json?.code]).toEqual([400, "INVALID_INPUT"]);
  }
  expect((await call("PUT", "x", "text/plain")).status).toBe(415);
  expect(save).not.toHaveBeenCalled();
});

test("PUT maps a storage failure to 503", async () => {
  save.mockResolvedValue(err({ code: "PERSISTENCE_UNAVAILABLE", message: "down" }));
  expect((await call("PUT", JSON.stringify({ name: null, phone: null }))).status).toBe(503);
});
