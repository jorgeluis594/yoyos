import { expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import type { CompanyId, OrderId } from "@core/src/features/orders";
import { checkCartOrder } from "@core/src/features/catalog/application/check-cart-order";

const companyId = "00000000-0000-4000-8000-000000000001" as CompanyId;
const orderId = "00000000-0000-4000-8000-0000000000a1" as OrderId;

test("answers confirmed for a confirmed catalog order of the store", async () => {
  const readCatalogOrderConfirmation = vi.fn(async () => ok("confirmed" as const));
  expect(await checkCartOrder({ orderId }, { companyId }, { readCatalogOrderConfirmation })).toEqual(ok("confirmed"));
  expect(readCatalogOrderConfirmation).toHaveBeenCalledWith(companyId, orderId);
});

test("answers not_confirmed for a pending, missing or other company order", async () => {
  expect(await checkCartOrder({ orderId }, { companyId }, { readCatalogOrderConfirmation: async () => ok("not_confirmed") })).toEqual(ok("not_confirmed"));
});

test("propagates PERSISTENCE_UNAVAILABLE", async () => {
  const failure = { code: "PERSISTENCE_UNAVAILABLE" as const, message: "down" };
  expect(await checkCartOrder({ orderId }, { companyId }, { readCatalogOrderConfirmation: async () => err(failure) })).toEqual(err(failure));
});
