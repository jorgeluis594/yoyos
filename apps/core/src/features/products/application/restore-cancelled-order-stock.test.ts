import { expect, test } from "vitest";
import { err, ok } from "@shared/functional";
import { restoreCancelledOrderStock, type RestoreCancelledOrderStockDependencies } from "@core/src/features/products/application/restore-cancelled-order-stock";
import type { CompanyId, OrderId } from "@core/src/features/orders";
import type { VariantId } from "@core/src/features/products/domain/product";
const payload = { orderId: "00000000-0000-4000-8000-000000000001" as OrderId, companyId: "00000000-0000-4000-8000-000000000002" as CompanyId };
const item = { variantId: "00000000-0000-4000-8000-000000000003" as VariantId, quantity: 2, stockDeductedQuantity: 2 };
const restoredItem = { variantId: item.variantId, quantity: 2 };
function fixture(cancelled = true, stockDeducted = true) {
  const restored: unknown[] = [];
  const published: unknown[] = [];
  const order: string[] = [];
  let marked = false;
  const deps: RestoreCancelledOrderStockDependencies = {
    transaction: async (_company, work) => work(),
    findOrderForUpdate: async () => ok({ cancelled, stockDeducted, items: [item] }),
    restoreProductStock: async (variantId, quantity) => { restored.push({ variantId, quantity }); return ok(null); },
    publishStockIncreased: async (event) => { published.push(event); order.push("publish"); return ok({ candidates: 0 }); },
    saveStockRestoration: async () => { marked = true; order.push("save"); return ok(null); },
  };
  return { deps, restored, published, order, marked: () => marked };
}
test("restores quantities and then clears the order flag", async () => {
  const f = fixture();
  expect(await restoreCancelledOrderStock(payload, f.deps)).toEqual(ok(undefined));
  expect(f.restored).toEqual([restoredItem]);
  expect(f.marked()).toBe(true);
});
test("already restored deliveries succeed without stock changes", async () => {
  const f = fixture(true, false);
  expect(await restoreCancelledOrderStock(payload, f.deps)).toEqual(ok(undefined));
  expect(f.restored).toEqual([]);
  expect(f.marked()).toBe(false);
});
test.each([null, { cancelled: false, stockDeducted: true, items: [item] }])("rejects inconsistent orders permanently", async order => {
  const f = fixture();
  expect(await restoreCancelledOrderStock(payload, { ...f.deps, findOrderForUpdate: async () => ok(order) }))
    .toMatchObject({ success: false, error: { code: "INVALID_ORDER", retryable: false } });
  expect(f.restored).toEqual([]);
});
test("stock failures remain retryable and do not clear the flag", async () => {
  const f = fixture();
  expect(await restoreCancelledOrderStock(payload, { ...f.deps,
    restoreProductStock: async () => err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unavailable" }),
  })).toMatchObject({ success: false, error: { retryable: true } });
  expect(f.marked()).toBe(false);
});
test("publishes only the restored variants after incrementing their stock", async () => {
  const f = fixture();
  await restoreCancelledOrderStock(payload, f.deps);
  expect(f.published).toEqual([{ companyId: payload.companyId, variantIds: [item.variantId] }]);
  expect(f.order).toEqual(["publish", "save"]);
});
test("a duplicate cancellation event publishes nothing", async () => {
  const f = fixture(true, false);
  await restoreCancelledOrderStock(payload, f.deps);
  expect(f.published).toEqual([]);
});
test("a contained waiting-order failure still commits the restoration", async () => {
  const f = fixture();
  const result = await restoreCancelledOrderStock(payload, { ...f.deps, publishStockIncreased: async () => ok({ failed: { errorCode: "STATEMENT_TIMEOUT" }, budgetExhausted: true }) });
  expect(result).toEqual(ok(undefined));
  expect(f.marked()).toBe(true);
});
test("only a failed increment or a transaction-ending error makes the restoration retryable", async () => {
  const f = fixture();
  const ending = await restoreCancelledOrderStock(payload, { ...f.deps,
    publishStockIncreased: async () => err({ code: "PERSISTENCE_UNAVAILABLE", message: "closed", transactionEnding: true }) });
  expect(ending).toMatchObject({ success: false, error: { retryable: true } });
  expect(f.marked()).toBe(false);
});
