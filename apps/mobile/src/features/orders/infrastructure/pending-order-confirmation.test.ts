import { createPendingOrderConfirmationStore } from "@mobile/features/orders/infrastructure/pending-order-confirmation";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test.each([true, false])("legacy delivery attempts remain intact after restart (customer charge: %s)", async (chargeDeliveryToCustomer) => {
  const pending = { version: 2 as const, companyId: id(1), id: id(2), shownTotal: { amount: 10, currency: "PEN" as const },
    request: { id: id(2), contactId: id(5), items: [{ variantId: id(3), quantity: 2 }],
      payments: [{ paymentId: id(4), amount: { amount: 3, currency: "PEN" as const }, method: "bank_transfer" as const, deductStockIfPartial: false }],
      delivery: { chargeDeliveryToCustomer, delivery: { method: "home" as const,
        recipient: { name: "Ana", phone: "999", identity: { kind: "absent" as const } },
        destination: { address: "Calle original", district: "Lima", instructions: "Puerta lateral" } } }, deliverImmediately: false } };
  const raw = JSON.stringify(pending);
  const key = `yoyos_pending_order_${id(1)}`;
  const values = new Map([[key, raw]]);
  const setItemAsync = jest.fn(async (storageKey: string, value: string) => { values.set(storageKey, value); });
  const deleteItemAsync = jest.fn(async (storageKey: string) => { values.delete(storageKey); });
  const store = createPendingOrderConfirmationStore({ getItemAsync: async (storageKey) => values.get(storageKey) ?? null,
    setItemAsync, deleteItemAsync });
  expect(await store.read(id(1))).toEqual({ success: true, data: pending });
  expect(await store.save({ ...pending, request: { ...pending.request, delivery: undefined, payments: [] } }))
    .toEqual({ success: true, data: pending });
  expect(values.get(key)).toBe(raw);
  expect(setItemAsync).not.toHaveBeenCalled();
  expect(deleteItemAsync).not.toHaveBeenCalled();
});

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

test("review replacement rejects another identity and retains the original on storage failure", async () => {
  const pending = { companyId: id(1), id: id(2), shownTotal: { amount: 10, currency: "PEN" as const } };
  let raw = JSON.stringify(pending);
  let fail = true;
  const deleteItemAsync = jest.fn(async () => {});
  const store = createPendingOrderConfirmationStore({ getItemAsync: async () => raw,
    setItemAsync: async (_key, value) => { if (fail) throw new Error("Storage failed"); raw = value; }, deleteItemAsync });
  const next = { ...pending, shownTotal: { amount: 12, currency: "PEN" as const } };
  expect(await store.replace(pending, { ...next, id: id(3) })).toMatchObject({ success: false, error: { code: "INVALID_PENDING_DATA" } });
  expect(await store.replace(pending, next)).toMatchObject({ success: false, error: { code: "PENDING_STORAGE_UNAVAILABLE" } });
  expect(await store.read(id(1))).toEqual({ success: true, data: pending });
  fail = false;
  expect(await store.replace(pending, next)).toEqual({ success: true, data: next });
  expect(await store.replace(pending, pending)).toMatchObject({ success: false, error: { code: "PENDING_CONFIRMATION" } });
  expect(await store.read(id(1))).toEqual({ success: true, data: next });
  expect(deleteItemAsync).not.toHaveBeenCalled();
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

test("rated pending creation survives restart without losing the reviewed price or selected rate", async () => {
  const values = new Map<string, string>();
  const storage = { getItemAsync: async (key: string) => values.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => { values.set(key, value); }, deleteItemAsync: async (key: string) => { values.delete(key); } };
  const pending = { version: 2 as const, companyId: id(1), id: id(2), shownTotal: { amount: 58, currency: "PEN" as const },
    request: { id: id(2), contactId: null, items: [{ variantId: id(3), quantity: 1 }], delivery: {
      expectedPrice: { amount: 8, currency: "PEN" as const }, delivery: {
        method: "home" as const, rateId: id(6), recipient: { name: "Ana", phone: "999", identity: { kind: "absent" as const } },
        destination: { districtCode: "150122", address: "Calle 123", instructions: null },
      },
    } } };
  expect(await createPendingOrderConfirmationStore(storage).save(pending)).toEqual({ success: true, data: pending });
  const restarted = createPendingOrderConfirmationStore(storage);
  expect(await restarted.read(id(1))).toEqual({ success: true, data: pending });
  expect(await restarted.save({ ...pending, request: { ...pending.request, delivery: { ...pending.request.delivery,
    expectedPrice: { amount: 10, currency: "PEN" as const } } } })).toEqual({ success: true, data: pending });
  values.set(`yoyos_pending_order_${id(1)}`, JSON.stringify({ ...pending, request: { ...pending.request,
    delivery: { ...pending.request.delivery, chargeDeliveryToCustomer: false } } }));
  expect(await restarted.read(id(1))).toMatchObject({ success: false, error: { code: "INVALID_PENDING_DATA" } });
});
