import express from "express";
import { afterEach, expect, test, vi } from "vitest";
import { ok, err } from "@shared/functional";
import type { CompanyId, OrderId } from "@core/src/features/orders/domain/order";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import { orders } from "@core/src/features/orders";
import { deliverySettings } from "@core/src/features/delivery-settings/composition";
import { quotationRoutes } from "@core/src/features/delivery-settings/presentation/quotation-routes";

const companyId = "00000000-0000-4000-8000-000000000001" as CompanyId;
const orderId = "00000000-0000-4000-8000-000000000002" as OrderId;
const servers: import("node:http").Server[] = [];
async function request() {
  const app = express();
  app.use(express.json());
  app.use("/api/quotations", quotationRoutes);
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  const response = await fetch(`http://127.0.0.1:${address.port}/api/quotations`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ orderId, destination: { country: "PE", districtCode: "150122" } }) });
  return { status: response.status, body: await response.json() };
}
function authorize() {
  vi.spyOn(orders, "resolveBuyerAccess").mockResolvedValue(ok({ kind: "buyer", companyId, orderId }));
  return vi.spyOn(orders, "getCheckout").mockResolvedValue(ok({ companyName: "Shop", number: 1001 as OrderNumber, buyer: null, items: [],
    itemsTotal: { amount: 0, currency: "PEN" }, total: { amount: 0, currency: "PEN" }, state: { kind: "pending" } }));
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

test("quotation HTTP keeps storage failures distinct from empty coverage and sanitizes private errors", async () => {
  const checkout = authorize();
  const create = vi.spyOn(deliverySettings, "createQuotation");
  for (const [error, status] of [
    [{ code: "SERVICE_UNAVAILABLE", message: "private database detail" }, 503],
    [{ code: "INTERNAL_ERROR", message: "private stored data" }, 500],
    [{ code: "INVALID_DELIVERY_SETTINGS", message: "private settings" }, 422],
    [{ code: "INVALID_DELIVERY_RATE", message: "private price" }, 422],
    [{ code: "INVALID_INPUT", message: "private identity" }, 400],
    [{ code: "INVALID_DESTINATION", message: "private address", field: "address" }, 422],
    [{ code: "INVALID_DISTRICT", message: "private district", districtCode: "999999" }, 422],
  ] as const) {
    create.mockResolvedValueOnce(err(error));
    const response = await request();
    expect(response.status).toBe(status);
    expect(response.body).toMatchObject({ code: error.code, error: "Unable to create quotation" });
    expect(JSON.stringify(response.body)).not.toContain("private");
    expect(response.body).not.toHaveProperty("rates");
  }
  expect(checkout).toHaveBeenCalledWith({ companyId, orderId });
  expect(create).toHaveBeenCalledWith({ companyId, country: "PE", districtCode: "150122", address: null, instructions: null });
});

test("failed checkout authorization never creates a quotation or falls back to seller context", async () => {
  const checkout = authorize();
  const create = vi.spyOn(deliverySettings, "createQuotation");
  checkout.mockResolvedValueOnce(err({ code: "PERSISTENCE_UNAVAILABLE", message: "private storage" }));
  expect(await request()).toMatchObject({ status: 503, body: { code: "SERVICE_UNAVAILABLE" } });
  checkout.mockResolvedValueOnce(err({ code: "INVALID_CHECKOUT", message: "private corrupted data" }));
  expect(await request()).toMatchObject({ status: 500, body: { code: "INTERNAL_ERROR" } });
  checkout.mockResolvedValueOnce(err({ code: "CHECKOUT_UNAVAILABLE", message: "private disabled" }));
  expect(await request()).toMatchObject({ status: 404, body: { code: "CHECKOUT_UNAVAILABLE" } });
  expect(create).not.toHaveBeenCalled();
});
