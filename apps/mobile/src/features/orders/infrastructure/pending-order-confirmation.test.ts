import { createPendingOrderConfirmationStore } from "@mobile/features/orders/infrastructure/pending-order-confirmation";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("pending confirmation is company scoped, keeps its first amount, and refuses a different ID", async () => {
  const values = new Map<string, string>();
  const store = createPendingOrderConfirmationStore({
    getItemAsync: async (key) => values.get(key) ?? null,
    setItemAsync: async (key, value) => { values.set(key, value); },
    deleteItemAsync: async (key) => { values.delete(key); },
  });
  const pending = { companyId: id(1), id: id(2), shownTotal: { amount: 10, currency: "PEN" as const } };
  expect(await store.save(pending)).toMatchObject({ success: true, data: pending });
  expect(await store.read(id(3))).toEqual({ success: true, data: null });
  expect(await store.save({ ...pending, shownTotal: { amount: 12, currency: "PEN" } })).toMatchObject({ success: true, data: pending });
  expect(await store.save({ ...pending, id: id(4) })).toMatchObject({ success: false, error: { code: "PENDING_CONFIRMATION" } });
  expect(await store.clear(id(1), id(4))).toMatchObject({ success: false, error: { code: "PENDING_CONFIRMATION" } });
  expect(await store.read(id(1))).toMatchObject({ success: true, data: pending });
  expect(await store.clear(id(1), id(2))).toEqual({ success: true, data: undefined });
  expect(await store.read(id(1))).toEqual({ success: true, data: null });
});

test("corrupt or unreadable pending data never looks like absence", async () => {
  const invalid = createPendingOrderConfirmationStore({
    getItemAsync: async () => JSON.stringify({ companyId: id(1), id: id(2), items: [] }),
    setItemAsync: async () => {}, deleteItemAsync: async () => {},
  });
  expect(await invalid.read(id(1))).toMatchObject({ success: false, error: { code: "INVALID_PENDING_DATA" } });
  const unavailable = createPendingOrderConfirmationStore({
    getItemAsync: async () => { throw new Error("Keychain unavailable"); },
    setItemAsync: async () => {}, deleteItemAsync: async () => {},
  });
  expect(await unavailable.read(id(1))).toMatchObject({ success: false, error: { code: "PENDING_STORAGE_UNAVAILABLE" } });
});

test("versioned pending requests survive restart unchanged and reject mismatched identities", async () => {
  const values = new Map<string, string>();
  const storage = { getItemAsync: async (key: string) => values.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => { values.set(key, value); }, deleteItemAsync: async (key: string) => { values.delete(key); } };
  const pending = { version: 2 as const, companyId: id(1), id: id(2), shownTotal: { amount: 10, currency: "PEN" as const },
    request: { id: id(2), contactId: null, items: [{ variantId: id(3), quantity: 1 }],
      payments: [{ paymentId: id(4), amount: { amount: 3, currency: "PEN" as const }, method: "bank_transfer" as const, deductStockIfPartial: true }], deliverImmediately: false } };
  expect(await createPendingOrderConfirmationStore(storage).save(pending)).toEqual({ success: true, data: pending });
  const restarted = createPendingOrderConfirmationStore(storage);
  expect(await restarted.read(id(1))).toEqual({ success: true, data: pending });
  expect(await restarted.save({ ...pending, request: { ...pending.request, payments: [] } })).toEqual({ success: true, data: pending });
  values.set(`yoyos_pending_order_${id(1)}`, JSON.stringify({ ...pending, request: { ...pending.request, id: id(9) } }));
  expect(await restarted.read(id(1))).toMatchObject({ success: false, error: { code: "INVALID_PENDING_DATA" } });
});
