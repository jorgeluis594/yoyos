import express from "express";
import { afterEach, expect, test, vi } from "vitest";
import { hasDuplicateJsonKeys, orderRoutes } from "@core/src/features/orders/presentation/api-routes";
import * as orderComposition from "@core/src/features/orders/composition";
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
  const create = vi.spyOn(orders, "registerImmediateSale").mockResolvedValue({ success: false,
    error: { code: "INSUFFICIENT_STOCK", message: "No stock", variantId: contactId } });
  const pending = vi.spyOn(orderComposition, "createConfiguredOrder").mockResolvedValue({ success: false,
    error: { code: "ORDER_ALREADY_EXISTS", message: "Exists" } });
  const input = { id: "00000000-0000-4000-8000-000000000003", contactId: null,
    items: [{ variantId: contactId, quantity: 2 }] };
  expect(await request("/", "PE", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...input, sellerId: "intruder" }) }))
    .toMatchObject({ status: 400, body: { code: "INVALID_INPUT" } });
  const response = await request("/", "PE", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...input, payment: { method: "digital_wallet" }, delivery: { method: "handover" } }) });
  expect(response).toMatchObject({ status: 409, body: { code: "INSUFFICIENT_STOCK",
    issues: [{ field: "items", variantId: contactId }] } });
  expect(create).toHaveBeenCalledOnce();
  expect(create).toHaveBeenCalledWith(input, { companyId, userId: "seller" });
  expect(pending).not.toHaveBeenCalled();
  expect(await request("/", "PE", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }))
    .toMatchObject({ status: 409, body: { code: "ORDER_ALREADY_EXISTS" } });
  expect(pending).toHaveBeenCalledWith({ ...input, payments: undefined, delivery: undefined, deliverImmediately: undefined }, { companyId, userId: "seller" });
  expect(create).toHaveBeenCalledOnce();
  expect(await request("/", "PE", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...input, payment: { method: "digital_wallet" } }) }))
    .toMatchObject({ status: 400, body: { code: "INVALID_INPUT" } });
  expect(pending).toHaveBeenCalledOnce();
});

test("JSON key validation scopes keys to each object and decodes escaped names", () => {
  expect(hasDuplicateJsonKeys('{"id":1,"items":[{"id":2},{"id":3}]}')).toBe(false);
  expect(hasDuplicateJsonKeys('{"id":1,"\\u0069d":2}')).toBe(true);
  expect(hasDuplicateJsonKeys('{"items":[{"quantity":1,"quantity":2}]}')).toBe(true);
});

test("delivery HTTP rejects client authority and maps disabled or locked delivery", async () => {
  const set = vi.spyOn(orders, "setDelivery").mockResolvedValue({ success: false, error: { code: "DELIVERY_METHOD_DISABLED", message: "Disabled" } });
  const body = { delivery: { method: "store", recipient: { name: "Recipient", phone: "999", identity: { kind: "absent" } } }, chargeDeliveryToCustomer: true };
  const put = (input: unknown): RequestInit => ({ method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  for (const extra of [{ cost: 0 }, { companyId: "other" }, { recordedBy: { kind: "buyer" } }]) {
    expect(await request(`/${contactId}/delivery`, "PE", put({ ...body, ...extra }))).toMatchObject({ status: 400 });
  }
  for (const extra of [{ recordedBy: { kind: "seller", userId: "other" } }, { pickupPoint: { name: "Fake", address: "Fake", instructions: null } }]) {
    expect(await request(`/${contactId}/delivery`, "PE", put({ ...body, delivery: { ...body.delivery, ...extra } }))).toMatchObject({ status: 400 });
  }
  expect(set).not.toHaveBeenCalled();
  expect(await request(`/${contactId}/delivery`, "PE", put(body))).toMatchObject({ status: 422, body: { code: "DELIVERY_METHOD_DISABLED" } });
  expect(set).toHaveBeenCalledWith({ orderId: contactId, ...body }, { companyId, userId: "seller" });
  set.mockResolvedValueOnce({ success: false, error: { code: "DELIVERY_LOCKED", message: "Locked" } });
  expect(await request(`/${contactId}/delivery`, "PE", put(body))).toMatchObject({ status: 409, body: { code: "DELIVERY_LOCKED" } });
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


test("mixed order API validates and forwards search and work filters", async () => {
  const list = vi.spyOn(orders, "listAggregates").mockResolvedValue({ success: true, data: { items: [], page: 1, pageSize: 20, total: 0 } });
  expect(await request("/mixed?view=invalid")).toMatchObject({ status: 400 });
  expect(await request(`/mixed?search=${"a".repeat(121)}`)).toMatchObject({ status: 400 });
  expect(list).not.toHaveBeenCalled();
  expect(await request("/mixed?search=%231005&view=unpaid")).toMatchObject({ status: 200 });
  expect(list).toHaveBeenCalledWith(expect.objectContaining({ search: "#1005", view: "unpaid" }),
    expect.objectContaining({ companyId }));
});
