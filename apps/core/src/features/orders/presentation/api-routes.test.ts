import express from "express";
import { afterEach, expect, test, vi } from "vitest";
import { hasDuplicateJsonKeys, orderRoutes } from "@core/src/features/orders/presentation/api-routes";
import { orders } from "@core/src/features/orders/composition";
import { app as fullApp } from "@core/src/app";

const companyId = "00000000-0000-4000-8000-000000000001";
const contactId = "00000000-0000-4000-8000-000000000002";
const servers: import("node:http").Server[] = [];

async function request(path: string, country = "PE", init?: RequestInit) {
  const app = express();
  app.use(express.json());
  app.use((_request, response, next) => {
    response.locals.auth = { company: { id: companyId, country }, user: { id: "seller" } };
    next();
  });
  app.use("/api/orders", orderRoutes);
  const server = app.listen(0);
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  const response = await fetch(`http://127.0.0.1:${address.port}/api/orders${path}`, init);
  return { status: response.status, body: await response.json() };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

test("order API validates filters before reading orders", async () => {
  const list = vi.spyOn(orders, "list");
  expect(await request(`/?customer=all&contactId=${contactId}`)).toMatchObject({ status: 400, body: { code: "INVALID_INPUT" } });
  expect(await request("/?page=1&page=2")).toMatchObject({ status: 400, body: { code: "INVALID_INPUT" } });
  expect(list).not.toHaveBeenCalled();
});

test("order API maps a validated contact and UTC interval to the existing list operation", async () => {
  const list = vi.spyOn(orders, "list").mockResolvedValue({ success: true, data: { items: [], page: 2, pageSize: 20, total: 0 } });
  const response = await request(`/?page=2&customer=contact&contactId=${contactId}&completedFrom=2026-09-28T05%3A00%3A00.000Z&completedBefore=2026-09-29T05%3A00%3A00.000Z`, "CL");
  expect(response).toMatchObject({ status: 200, body: { page: 2, items: [] } });
  expect(list).toHaveBeenCalledWith({ page: 2, customer: { kind: "contact", contactId },
    completedFrom: new Date("2026-09-28T05:00:00.000Z"), completedBefore: new Date("2026-09-29T05:00:00.000Z") });
});

test("order API takes company and seller from access and identifies rejected stock", async () => {
  const create = vi.spyOn(orders, "create").mockResolvedValue({ success: false,
    error: { code: "INSUFFICIENT_STOCK", message: "No stock", variantId: contactId } });
  const input = { id: "00000000-0000-4000-8000-000000000003", contactId: null,
    items: [{ variantId: contactId, quantity: 2 }] };
  expect(await request("/", "PE", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...input, sellerId: "intruder" }) }))
    .toMatchObject({ status: 400, body: { code: "INVALID_INPUT" } });
  const response = await request("/", "PE", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  expect(response).toMatchObject({ status: 409, body: { code: "INSUFFICIENT_STOCK",
    issues: [{ field: "items", variantId: contactId }] } });
  expect(create).toHaveBeenCalledOnce();
  expect(create).toHaveBeenCalledWith(input, { companyId, sellerId: "seller" });
});

test("JSON key validation scopes keys to each object and decodes escaped names", () => {
  expect(hasDuplicateJsonKeys('{"id":1,"items":[{"id":2},{"id":3}]}')).toBe(false);
  expect(hasDuplicateJsonKeys('{"id":1,"\\u0069d":2}')).toBe(true);
  expect(hasDuplicateJsonKeys('{"items":[{"quantity":1,"quantity":2}]}')).toBe(true);
});

test("order JSON errors preserve no-store before authentication", async () => {
  const server = fullApp.listen(0);
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  const base = `http://127.0.0.1:${address.port}/api/orders`;
  for (const [body, status] of [['{"id":1,"id":2}', 400], ["{", 400], [JSON.stringify({ value: "x".repeat(103_000) }), 413]] as const) {
    const response = await fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body });
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await response.json()).code).toBe(status === 413 ? "PAYLOAD_TOO_LARGE" : "INVALID_INPUT");
  }
});
