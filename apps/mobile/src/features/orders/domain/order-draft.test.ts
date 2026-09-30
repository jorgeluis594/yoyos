import { addDraftItem, changeDraftQuantity, emptyOrderDraft, prepareOrder, removeDraftItem, setDraftCustomer } from "@mobile/features/orders/domain/order-draft";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const item = (n: number, amount: number, currency = "PEN", stock = 3) => ({
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

test("cart rejects unavailable stock, invalid quantities, and mixed currencies", () => {
  expect(addDraftItem(emptyOrderDraft(), item(1, 1, "PEN", 0), () => id(9)).success).toBe(false);
  const first = addDraftItem(emptyOrderDraft(), item(1, 1), () => id(9));
  expect(first.success).toBe(true);
  if (!first.success) return;
  expect(changeDraftQuantity(first.data, id(1), 4).success).toBe(false);
  expect(changeDraftQuantity(first.data, id(1), 0).success).toBe(false);
  expect(addDraftItem(first.data, item(2, 1, "USD"), () => id(8)).success).toBe(false);
});
