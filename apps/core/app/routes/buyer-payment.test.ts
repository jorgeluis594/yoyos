import { afterEach, expect, test, vi } from "vitest";
import type { LoaderFunctionArgs } from "react-router";
import { loader } from "@core/app/routes/buyer-payment";
import { orders } from "@core/src/features/orders/composition";
import { err, ok } from "@shared/functional";
import type { CompanyId, OrderId } from "@core/src/features/orders/domain/order";

const companyId = "00000000-0000-4000-8000-000000000001" as CompanyId;
const orderId = "00000000-0000-4000-8000-000000000002" as OrderId;
const open = (id: string) => loader({ params: { orderId: id } } as unknown as LoaderFunctionArgs);
const thrown = async (id: string) => open(id).then(() => { throw new Error("Expected a thrown response"); }, (response: Response) => response);
afterEach(() => vi.restoreAllMocks());

test("an existing order redirects permanently to its checkout without storing the page", async () => {
  vi.spyOn(orders, "resolveBuyerAccess").mockResolvedValue(ok({ kind: "buyer", companyId, orderId }));
  const response = await thrown(orderId);
  expect(response.status).toBe(301);
  expect(response.headers.get("Location")).toBe(`/checkout/${companyId}/${orderId}`);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
});

test("a missing order or invalid id answers 404", async () => {
  const resolve = vi.spyOn(orders, "resolveBuyerAccess");
  resolve.mockResolvedValue(err({ code: "ORDER_NOT_FOUND", message: "Order not found" }));
  expect((await thrown(orderId)).status).toBe(404);
  resolve.mockResolvedValue(err({ code: "INVALID_ORDER", message: "Invalid order ID" }));
  expect((await thrown("not-a-uuid")).status).toBe(404);
});

test("a database failure answers 503", async () => {
  vi.spyOn(orders, "resolveBuyerAccess").mockResolvedValue(err({ code: "PERSISTENCE_UNAVAILABLE", message: "Database down" }));
  expect((await thrown(orderId)).status).toBe(503);
});
