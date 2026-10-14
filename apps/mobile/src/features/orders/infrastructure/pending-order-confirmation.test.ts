import { createPendingOrderConfirmationStore } from "@mobile/features/orders/infrastructure/pending-order-confirmation";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const simple = (shownAmount = 10, orderId = id(2)) => ({ companyId: id(1), id: orderId, shownTotal: { amount: shownAmount, currency: "PEN" as const },
  version: 2 as const, request: { id: orderId, items: [{ variantId: id(3), quantity: 1 }] } });
const memory = (values = new Map<string, string>()) => ({ values, storage: {
  getItemAsync: async (key: string) => values.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => { values.set(key, value); },
  deleteItemAsync: async (key: string) => { values.delete(key); } } });

test("sales queue per company in order, keep their first amount and clear one by one", async () => {
  const { storage } = memory();
  const store = createPendingOrderConfirmationStore(storage);
  const first = simple(10, id(2));
  const second = simple(20, id(4));
  expect(await store.save(first)).toEqual({ success: true, data: first });
  expect(await store.save(second)).toEqual({ success: true, data: second });
  expect(await store.save({ ...first, shownTotal: { amount: 12, currency: "PEN" } })).toEqual({ success: true, data: first });
  expect(await store.list(id(1))).toEqual({ success: true, data: [first, second] });
  expect(await store.list(id(9))).toEqual({ success: true, data: [] });
  expect(await store.read(id(1), id(4))).toEqual({ success: true, data: second });
  expect(await store.clear(id(1), id(2))).toEqual({ success: true, data: undefined });
  expect(await createPendingOrderConfirmationStore(storage).list(id(1))).toEqual({ success: true, data: [second] });
  expect(await store.read(id(1), id(2))).toEqual({ success: true, data: null });
});

test("a sale saved before the queue joins it and is not lost", async () => {
  const pending = simple();
  const { values, storage } = memory(new Map([[`yoyos_pending_order_${id(1)}`, JSON.stringify(pending)]]));
  const store = createPendingOrderConfirmationStore(storage);
  expect(await store.list(id(1))).toEqual({ success: true, data: [pending] });
  expect(values.has(`yoyos_pending_order_${id(1)}`)).toBe(false);
  expect(await store.save(simple(5, id(4)))).toMatchObject({ success: true });
  expect(await store.list(id(1))).toMatchObject({ success: true, data: [pending, { id: id(4) }] });
});

test.each([true, false])("attempts saved with the obsolete delivery shape or without a version are invalid and can be discarded (charge: %s)", async (obsoleteCharge) => {
  const obsolete = { ...simple(), request: { ...simple().request, delivery: { obsoleteCharge, delivery: { method: "home" as const,
    recipient: { name: "Ana", phone: "999", identity: { kind: "absent" as const } },
    destination: { address: "Calle original", district: "Lima", instructions: "Puerta lateral" } } } } };
  const { version: _version, request: _request, ...unversioned } = simple();
  for (const stored of [obsolete, unversioned]) {
    const { storage } = memory(new Map([[`yoyos_pending_order_${id(1)}`, JSON.stringify(stored)]]));
    const store = createPendingOrderConfirmationStore(storage);
    expect(await store.list(id(1))).toMatchObject({ success: false, error: { code: "INVALID_PENDING_DATA" } });
    expect(await store.discard(id(1))).toEqual({ success: true, data: undefined });
    expect(await store.list(id(1))).toEqual({ success: true, data: [] });
  }
});

test("discarding drops only unreadable sales", async () => {
  const { values, storage } = memory();
  const store = createPendingOrderConfirmationStore(storage);
  const kept = simple(10, id(2));
  await store.save(kept); await store.save(simple(10, id(4)));
  values.set(`yoyos_pending_order_${id(1)}_${id(4)}`, JSON.stringify({ ...simple(10, id(4)), request: { id: id(9), items: [] } }));
  expect(await store.list(id(1))).toMatchObject({ success: false, error: { code: "INVALID_PENDING_DATA" } });
  expect(await store.discard(id(1))).toEqual({ success: true, data: undefined });
  expect(await store.list(id(1))).toEqual({ success: true, data: [kept] });
});

test("corrupt or unreadable pending data never looks like absence", async () => {
  const invalid = createPendingOrderConfirmationStore({
    getItemAsync: async () => JSON.stringify({ companyId: id(1), id: id(2), items: [] }),
    setItemAsync: async () => {}, deleteItemAsync: async () => {},
  });
  expect(await invalid.list(id(1))).toMatchObject({ success: false, error: { code: "INVALID_PENDING_DATA" } });
  const unavailable = createPendingOrderConfirmationStore({
    getItemAsync: async () => { throw new Error("Keychain unavailable"); },
    setItemAsync: async () => {}, deleteItemAsync: async () => {},
  });
  expect(await unavailable.list(id(1))).toMatchObject({ success: false, error: { code: "PENDING_STORAGE_UNAVAILABLE" } });
});

test("a failed index write leaves the sale out of the queue instead of half saved", async () => {
  const { values, storage } = memory();
  const store = createPendingOrderConfirmationStore({ ...storage, setItemAsync: async (key, value) => {
    if (key.startsWith("yoyos_pending_orders_")) throw new Error("Storage failed");
    values.set(key, value);
  } });
  expect(await store.save(simple())).toMatchObject({ success: false, error: { code: "PENDING_STORAGE_UNAVAILABLE" } });
  expect(await createPendingOrderConfirmationStore(storage).list(id(1))).toEqual({ success: true, data: [] });
});

test("review replacement rejects another identity and retains the original on storage failure", async () => {
  const { values, storage } = memory();
  let fail = false;
  const store = createPendingOrderConfirmationStore({ ...storage,
    setItemAsync: async (key, value) => { if (fail) throw new Error("Storage failed"); values.set(key, value); } });
  const pending = simple();
  await store.save(pending);
  const next = { ...simple(12), rejection: { code: "INSUFFICIENT_STOCK", message: "No stock" } };
  fail = true;
  expect(await store.replace(pending, simple(12, id(3)))).toMatchObject({ success: false, error: { code: "INVALID_PENDING_DATA" } });
  expect(await store.replace(pending, next)).toMatchObject({ success: false, error: { code: "PENDING_STORAGE_UNAVAILABLE" } });
  expect(await store.read(id(1), id(2))).toEqual({ success: true, data: pending });
  fail = false;
  expect(await store.replace(pending, next)).toEqual({ success: true, data: next });
  expect(await store.replace(pending, pending)).toMatchObject({ success: false, error: { code: "PENDING_CONFIRMATION" } });
  expect(await store.read(id(1), id(2))).toEqual({ success: true, data: next });
});

test("versioned requests survive restart unchanged and reject mismatched identities", async () => {
  const { values, storage } = memory();
  const pending = { version: 2 as const, companyId: id(1), id: id(2), shownTotal: { amount: 58, currency: "PEN" as const },
    request: { id: id(2), items: [{ variantId: id(3), quantity: 1 }], deliverImmediately: false,
      payments: [{ paymentId: id(4), amount: { amount: 3, currency: "PEN" as const }, method: "bank_transfer" as const, deductStockIfPartial: true }],
      delivery: { expectedPrice: { amount: 8, currency: "PEN" as const }, delivery: {
        method: "home" as const, rateId: id(6), recipient: { name: "Ana", phone: "999", identity: { kind: "absent" as const } },
        destination: { districtCode: "150122", address: "Calle 123", instructions: null } } } } };
  expect(await createPendingOrderConfirmationStore(storage).save(pending)).toEqual({ success: true, data: pending });
  const restarted = createPendingOrderConfirmationStore(storage);
  expect(await restarted.list(id(1))).toEqual({ success: true, data: [pending] });
  expect(await restarted.save({ ...pending, request: { ...pending.request, payments: [] } })).toEqual({ success: true, data: pending });
  values.set(`yoyos_pending_order_${id(1)}_${id(2)}`, JSON.stringify({ ...pending, request: { ...pending.request, id: id(9) } }));
  expect(await restarted.list(id(1))).toMatchObject({ success: false, error: { code: "INVALID_PENDING_DATA" } });
});
