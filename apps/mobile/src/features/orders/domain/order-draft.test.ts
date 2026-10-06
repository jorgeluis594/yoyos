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
  expect(prepareOrder({ ...draft, payments: [payment, payment] })).toMatchObject({ success: false });
  expect(prepareOrder({ ...draft, payments: [{ ...payment, amount: "-1" }] })).toMatchObject({ success: false });
  expect(changeDraftQuantity({ ...draft, payments: [{ ...payment, amount: "" }] }, id(1), 2)).toMatchObject({ success: true });
});
