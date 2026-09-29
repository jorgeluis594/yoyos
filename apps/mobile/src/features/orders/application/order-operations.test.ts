import { err, ok } from "@shared/functional";
import { createOrderOperations } from "@mobile/features/orders/application/order-operations";
import { addDraftItem, emptyOrderDraft } from "@mobile/features/orders/domain/order-draft";
import { createOrderApi } from "@mobile/features/orders/infrastructure/order-api";
import { createPendingOrderConfirmationStore } from "@mobile/features/orders/infrastructure/pending-order-confirmation";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const companyId = id(1);
const item = { variantId: id(2), productName: "Sample", variantAttributes: {}, sku: null,
  shownUnitPrice: { amount: 10, currency: "PEN" }, shownStock: 3, quantity: 1 };
const draft = () => {
  const result = addDraftItem(emptyOrderDraft(), item, () => id(3));
  if (!result.success) throw new Error("Invalid test cart");
  return result.data;
};
const storage = () => {
  const values = new Map<string, string>();
  return createPendingOrderConfirmationStore({ getItemAsync: async (key) => values.get(key) ?? null,
    setItemAsync: async (key, value) => { values.set(key, value); },
    deleteItemAsync: async (key) => { values.delete(key); } });
};

test("Lima day filters include the whole through day and reject inverted days", async () => {
  const paths: string[] = [];
  const api = createOrderApi(async (path) => { paths.push(path); return ok({ items: [], page: 1, pageSize: 20, total: 0 }); });
  const operations = createOrderOperations(api, storage());
  expect(await operations.loadOrders({ page: 1, customer: { kind: "all" }, fromDay: "1989-12-31", throughDay: "1989-12-31" }))
    .toMatchObject({ success: true, data: { total: 0 } });
  const query = new URL(`http://localhost${paths[0]}`).searchParams;
  expect(query.get("completedFrom")).toBe("1989-12-31T05:00:00.000Z");
  expect(query.get("completedBefore")).toBe("1990-01-01T04:00:00.000Z");
  expect(await operations.loadOrders({ page: 1, customer: { kind: "all" }, fromDay: "2026-09-29", throughDay: "2026-09-28" }))
    .toMatchObject({ success: false, error: { code: "INVALID_INPUT" } });
  expect(paths).toHaveLength(1);
});

test("save failure prevents POST; uncertain POST coalesces taps and blocks another order", async () => {
  let sends = 0;
  const api = createOrderApi(async (path) => path === "/api/orders" ? (sends++, err({ code: "NETWORK_ERROR", message: "Offline" }))
    : err({ code: "API_ERROR", message: "Absent", http: { status: 404, body: { code: "ORDER_NOT_FOUND", error: "Absent" } } }));
  const broken = createPendingOrderConfirmationStore({ getItemAsync: async () => null,
    setItemAsync: async () => { throw new Error("Cannot save"); }, deleteItemAsync: async () => {} });
  expect(await createOrderOperations(api, broken).completeOrder(draft(), companyId))
    .toMatchObject({ success: false, error: { code: "PENDING_STORAGE_UNAVAILABLE" } });
  expect(sends).toBe(0);
  const operations = createOrderOperations(api, storage());
  const selected = draft();
  const [first, second] = await Promise.all([operations.completeOrder(selected, companyId), operations.completeOrder(selected, companyId)]);
  expect(first).toEqual(second);
  expect(first).toMatchObject({ success: true, data: { kind: "uncertain", pending: { id: id(3) } } });
  expect(sends).toBe(1);
  expect(await operations.resolvePendingOrderConfirmation(companyId))
    .toMatchObject({ success: true, data: { kind: "uncertain", pending: { id: id(3) } } });
  const other = addDraftItem(emptyOrderDraft(), item, () => id(4));
  if (!other.success) throw new Error("Invalid second cart");
  expect(await operations.completeOrder(other.data, companyId))
    .toMatchObject({ success: false, error: { code: "PENDING_CONFIRMATION" } });
  expect(sends).toBe(1);
});

test("known stock rejection clears the marker and leaves the cart available", async () => {
  const api = createOrderApi(async () => err({ code: "API_ERROR", message: "No stock", http: { status: 409,
    body: { code: "INSUFFICIENT_STOCK", error: "No stock", issues: [{ field: "items", reason: "STOCK", variantId: id(2) }] } } }));
  const store = storage();
  const operations = createOrderOperations(api, store);
  const selected = draft();
  expect(await operations.completeOrder(selected, companyId)).toMatchObject({ success: false,
    error: { code: "INSUFFICIENT_STOCK", issues: [{ variantId: id(2) }] } });
  expect(await store.read(companyId)).toEqual(ok(null));
  expect(selected.kind).toBe("items");
});

test("recovery keeps the amount first shown and returns the core total", async () => {
  const order = { id: id(3), companyId, sellerId: "seller", customer: { kind: "general_public" },
    paymentMethod: "digital_wallet", completedAt: "2026-09-29T12:00:00.000Z", currency: "PEN", total: 12,
    items: [{ id: id(5), variantId: id(2), productName: "Sample", variantAttributes: {}, sku: null,
      quantity: 1, unitPrice: 12, subtotal: 12 }] };
  const api = createOrderApi(async (path) => path === "/api/orders"
    ? err({ code: "NETWORK_ERROR", message: "Lost response" }) : ok(order));
  const store = storage();
  const operations = createOrderOperations(api, store);
  expect(await operations.completeOrder(draft(), companyId)).toMatchObject({ success: true, data: { kind: "uncertain" } });
  expect(await operations.resolvePendingOrderConfirmation(companyId)).toMatchObject({ success: true,
    data: { kind: "completed", shownTotal: { amount: 10, currency: "PEN" }, order: { total: 12 } } });
  expect(await operations.loadOrder(id(3))).toMatchObject({ success: true, data: { total: 12 } });
  expect(await store.read(companyId)).toMatchObject({ success: true, data: { id: id(3) } });
  expect(await operations.clearPendingOrderConfirmation(companyId, id(3))).toEqual(ok(undefined));
});
