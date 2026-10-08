import { addDraftItem, changeDraftQuantity, emptyOrderDraft, prepareOrder, removeDraftItem, setDraftCustomer } from "@mobile/features/orders/domain/order-draft";
import type { Currency } from "@shared/money";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const item = (n: number, amount: number, currency: Currency = "PEN", stock = 3) => ({
  variantId: id(n), productName: `Product ${n}`, variantAttributes: {}, sku: null,
  shownUnitPrice: { amount, currency }, shownStock: stock, quantity: 1,
});

test("cart keeps its ID while quantities and customer change, and sends only references", () => {
  const first = addDraftItem(emptyOrderDraft(), item(1, 0.1), () => id(9));
  expect(first.success).toBe(true);
  if (!first.success) return;
  expect(addDraftItem(first.data, item(1, 0.1), () => id(8)).success).toBe(false);
  const changed = changeDraftQuantity(first.data, id(1), 3);
  expect(changed.success).toBe(true);
  if (!changed.success) return;
  const withCustomer = setDraftCustomer(changed.data, { kind: "contact", contactId: id(7), name: "Ana", phone: "999" });
  expect(prepareOrder(withCustomer)).toEqual({ success: true, data: {
    request: { id: id(9), contactId: id(7), items: [{ variantId: id(1), quantity: 3 }] },
    shownTotal: { amount: 0.3, currency: "PEN" },
  } });
  expect(prepareOrder(setDraftCustomer(withCustomer, { kind: "general_public" })))
    .toMatchObject({ success: true, data: { request: { contactId: null } } });
  expect(removeDraftItem(withCustomer, id(1))).toMatchObject({ kind: "empty", customer: { kind: "contact" } });
});

test("cart allows pending orders beyond stock but rejects invalid quantities and mixed currencies", () => {
  expect(addDraftItem(emptyOrderDraft(), item(1, 1, "PEN", 0), () => id(9)).success).toBe(true);
  const first = addDraftItem(emptyOrderDraft(), item(1, 1), () => id(9));
  expect(first.success).toBe(true);
  if (!first.success) return;
  expect(changeDraftQuantity(first.data, id(1), 4).success).toBe(true);
  expect(changeDraftQuantity(first.data, id(1), 0).success).toBe(false);
  expect(addDraftItem(first.data, item(2, 1, "USD"), () => id(8)).success).toBe(false);
});

test("complete draft validates payment identity and amount while preserving separate delivery intent", () => {
  const first = addDraftItem(emptyOrderDraft(), item(1, 10), () => id(9));
  if (!first.success) throw new Error("Invalid fixture");
  const payment = { paymentId: id(5), amount: "4.50", method: "bank_transfer" as const, deductStockIfPartial: false };
  const draft = { ...first.data, payments: [payment], deliverImmediately: false };
  expect(prepareOrder(draft)).toMatchObject({ success: true, data: { request: { payments: [{ paymentId: id(5),
    amount: { amount: 4.5, currency: "PEN" }, method: "bank_transfer", deductStockIfPartial: false }], deliverImmediately: false } } });
  expect(prepareOrder({ ...draft, payments: [{ ...payment, amount: "10,50" }] }))
    .toMatchObject({ success: true, data: { request: { payments: [{ amount: { amount: 10.5, currency: "PEN" } }] } } });
  expect(prepareOrder({ ...draft, payments: [{ ...payment, amount: "10,501" }] })).toMatchObject({ success: false });
  expect(prepareOrder({ ...draft, payments: [payment, payment] })).toMatchObject({ success: false });
  expect(prepareOrder({ ...draft, payments: [{ ...payment, amount: "-1" }] })).toMatchObject({ success: false });
  expect(changeDraftQuantity({ ...draft, payments: [{ ...payment, amount: "" }] }, id(1), 2)).toMatchObject({ success: true });
});

test("rated creation reviews one full delivery price and keeps only its selected rate", () => {
  const first = addDraftItem(emptyOrderDraft(), item(1, 50), () => id(9));
  if (!first.success) throw new Error("Invalid fixture");
  const ratedDelivery = { expectedPrice: { amount: 8, currency: "PEN" as const }, delivery: {
    method: "home" as const, rateId: id(6), recipient: { name: "Ana", phone: "999", identity: { kind: "absent" as const } },
    destination: { districtCode: "150122", address: "Calle 123", instructions: null },
  } };
  const draft = { ...first.data, ratedDelivery };
  expect(prepareOrder(draft)).toEqual({ success: true, data: {
    request: { id: id(9), contactId: null, items: [{ variantId: id(1), quantity: 1 }], delivery: ratedDelivery },
    shownTotal: { amount: 58, currency: "PEN" },
  } });
  expect(prepareOrder({ ...draft, ratedDelivery: { ...ratedDelivery, expectedPrice: { amount: 0, currency: "PEN" } } }))
    .toMatchObject({ success: true, data: { shownTotal: { amount: 50, currency: "PEN" } } });
  expect(prepareOrder({ ...draft, ratedDelivery: { ...ratedDelivery, expectedPrice: { amount: 8.001, currency: "PEN" } } })).toMatchObject({ success: false });
  expect(prepareOrder({ ...draft, ratedDelivery: { ...ratedDelivery, expectedPrice: { amount: 8, currency: "USD" } } })).toMatchObject({ success: false });
  expect(prepareOrder({ ...draft, ratedDelivery: { ...ratedDelivery, delivery: { ...ratedDelivery.delivery,
    destination: { ...ratedDelivery.delivery.destination, districtCode: "999999" } } } })).toMatchObject({ success: false });
  const changed = changeDraftQuantity(draft, id(1), 2);
  expect(changed.success && prepareOrder(changed.data)).toMatchObject({ success: true, data: { shownTotal: { amount: 108, currency: "PEN" } } });
  const pickup = { expectedPrice: { amount: 0, currency: "PEN" as const }, delivery: {
    method: "store" as const, recipient: ratedDelivery.delivery.recipient,
  } };
  expect(prepareOrder({ ...draft, ratedDelivery: pickup })).toMatchObject({ success: true, data: { shownTotal: { amount: 50, currency: "PEN" } } });
  expect(prepareOrder({ ...draft, ratedDelivery: { ...pickup, expectedPrice: { amount: 1, currency: "PEN" } } })).toMatchObject({ success: false });
});
