import { expect, test, vi } from "vitest";
import { ok } from "@shared/functional";
import { continueToCheckout } from "@core/src/features/catalog/application/continue-to-checkout";
import type { CompanyId, OrderId } from "@core/src/features/orders";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";

const companyId = "00000000-0000-4000-8000-000000000001" as CompanyId;
const input = { orderId: "00000000-0000-4000-8000-000000000002" as OrderId, lines: [] };

test("rejects continuing when the catalog is not published", async () => {
  const createCatalogOrder = vi.fn();
  expect(await continueToCheckout(input, { companyId }, { readPublished: async () => ok(false), createCatalogOrder }))
    .toMatchObject({ success: false, error: { code: "CATALOG_UNAVAILABLE" } });
  expect(createCatalogOrder).not.toHaveBeenCalled();
});

test("creates the catalog order with the cart id when the catalog is published", async () => {
  const order = { id: input.orderId } as OrderAggregate;
  const createCatalogOrder = vi.fn(async () => ok(order));
  expect(await continueToCheckout(input, { companyId }, { readPublished: async () => ok(true), createCatalogOrder })).toEqual(ok(order));
  expect(createCatalogOrder).toHaveBeenCalledWith({ id: input.orderId, lines: [] }, { companyId });
});
