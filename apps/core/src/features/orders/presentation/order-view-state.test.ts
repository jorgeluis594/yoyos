import { describe, expect, test } from "vitest";
import type { OrderAggregateResponse } from "@shared/contracts/orders";
import type { EditOrderResult } from "@core/src/features/orders/presentation/order-edit-schemas";
import {
  applySaveResult, buildCreateRequest, buildEditRequest, clearCustomer, customerRequired, estimate, inDoubtOutcome, initialDraft, invalidFields, isEmptyDraft, lineWarnings,
  refreshFromLoader, resetProducts, screenLocks, setCustomer, unsavedParts, type DeliveryDraft, type DraftLine, type LoadedOrder, type OrderViewState,
} from "@core/src/features/orders/presentation/order-view-state";

const orderId = "00000000-0000-4000-8000-000000001042";
const companyId = "00000000-0000-4000-8000-0000000000c1";
const trajeM = "00000000-0000-4000-8000-0000000000a1";
const trajeL = "00000000-0000-4000-8000-0000000000a2";
const deadpoolM = "00000000-0000-4000-8000-0000000000b1";
const crown = "00000000-0000-4000-8000-0000000000c2";
const rateId = "00000000-0000-4000-8000-0000000000e1";
const otherRateId = "00000000-0000-4000-8000-0000000000e2";
const revision = (letter: string) => letter.repeat(43);
const revisions = { items: revision("A"), customer: revision("B"), delivery: revision("C") };
const pen = (amount: number) => ({ amount, currency: "PEN" as const });

const item = (id: string, variantId: string, name: string, size: string, price: number, quantity = 1) => ({
  id, variantId, productName: name, variantAttributes: { Talla: size }, sku: null, quantity, unitPrice: pen(price), subtotal: pen(price * quantity), mentionedPrice: null,
});
const recipient = { name: "Jorge Gonzalez", phone: "+51977909427", identity: { kind: "absent" as const } };
const homeDelivery = {
  method: "home" as const, recipient,
  destination: { address: "Av. Lima 123", district: "Miraflores", instructions: "Puerta azul", country: "PE" as const, districtCode: "150122", province: "Lima", department: "Lima" },
  pricing: { quotationId: "00000000-0000-4000-8000-0000000000f1", rateId, optionId: "00000000-0000-4000-8000-0000000000f2", settingsVersion: 1 },
  recordedBy: { kind: "seller" as const, userId: "user-1" },
};
const yape = {
  id: "00000000-0000-4000-8000-0000000000d1", orderId, status: "confirmed" as const, amount: pen(150), method: "digital_wallet" as const, walletProvider: "yape" as const,
  data: { confirmedAt: "2026-10-30T09:20:00.000Z", confirmedBy: { kind: "seller" as const, userId: "user-1" }, evidence: { kind: "manual" as const } },
};

function order1042(patch: Partial<OrderAggregateResponse> = {}): OrderAggregateResponse {
  return {
    checkoutEnabledAt: null, checkoutConfirmedAt: null, number: 1042, id: orderId, companyId, sellerId: "user-1", buyer: { contactId: null, name: "Jorge Gonzalez", phone: "+51977909427" },
    source: "manual", createdAt: "2026-10-30T09:10:00.000Z", scheduledDispatchDate: null, shippedAt: null, deliveredAt: null, completedAt: null, status: "active",
    paymentStatus: "pending", paidAmount: pen(150), balanceDue: pen(148), overpaidAmount: pen(0), cancelled: false, delivery: homeDelivery, deliveryStatus: "pending",
    stockDeducted: false, stockDue: null,
    items: [item("00000000-0000-4000-8000-000000000001", trajeM, "Traje de Príncipe Azul", "M", 89), item("00000000-0000-4000-8000-000000000002", trajeL, "Traje de Príncipe Azul", "L", 89),
      item("00000000-0000-4000-8000-000000000003", deadpoolM, "Disfraz de Deadpool", "M", 120)],
    payments: [yape], itemsTotal: pen(298), deliveryCost: pen(0), deliveryCharge: pen(0), total: pen(298), ...patch,
  };
}

const catalog = { [trajeM]: { stock: 5 }, [trajeL]: { stock: 2 }, [deadpoolM]: { stock: 4 } };
const loaded = (patch: Partial<LoadedOrder> = {}): LoadedOrder => ({ order: order1042(), revisions, lineCatalog: catalog, ...patch });
const savedState = (patch: Partial<LoadedOrder> = {}) => initialDraft({ kind: "saved", ...loaded(patch) });

/** Replaces a quantity as the seller would type it. */
function typeQuantity(state: OrderViewState, variantId: string, quantityText: string): OrderViewState {
  return { ...state, draft: { ...state.draft, items: state.draft.items.map((line) => line.variantId === variantId ? { ...line, quantityText } : line) } };
}
const newLine = (variantId: string, quantityText = "1"): DraftLine => ({ variantId, productName: "Corona de Príncipe", attributes: {}, sku: null, unitPrice: pen(35),
  quantityText, stock: 10, sellable: true });
/** Turns «Igual que el cliente» off, as a seller who edits the customer of an order where another person receives. */
const unmirrored = (state: OrderViewState): OrderViewState => ({ ...state, draft: { ...state.draft, delivery: { ...state.draft.delivery, sameAsCustomer: false } } });
const withDelivery = (state: OrderViewState, patch: Omit<Partial<DeliveryDraft>, "fields"> & { fields?: Partial<DeliveryDraft["fields"]> }): OrderViewState => ({
  ...state, draft: { ...state.draft, delivery: { ...state.draft.delivery, ...patch, fields: { ...state.draft.delivery.fields, ...patch.fields } } } });

function expectRequest(result: ReturnType<typeof buildEditRequest>) {
  if (!result.success) throw new Error(`Expected a request, got ${result.error.code}`);
  return result.data;
}

describe("unsaved changes", () => {
  test("reports no unsaved changes after raising a quantity and lowering it back", () => {
    const start = savedState();
    expect(unsavedParts(start)).toEqual([]);
    const raised = typeQuantity(start, deadpoolM, "2");
    expect(unsavedParts(raised)).toEqual(["items"]);
    expect(unsavedParts(typeQuantity(raised, deadpoolM, "1"))).toEqual([]);
  });

  test("ignores the order of the lines and the typed leading zeros when comparing", () => {
    const start = savedState();
    const reordered = { ...start, draft: { ...start.draft, items: [...start.draft.items].reverse() } };
    expect(unsavedParts(typeQuantity(reordered, deadpoolM, "01"))).toEqual([]);
  });

  test("reports each edited part in screen order", () => {
    const edited = withDelivery(setCustomer(typeQuantity(savedState(), deadpoolM, "2"), { name: "Ana", phone: "+51988111222" }), { fields: { address: "Jr. Cusco 10" } });
    expect(unsavedParts(edited)).toEqual(["items", "customer", "delivery"]);
  });
});

describe("empty draft", () => {
  test("treats a new sale with nothing typed as empty and any typed field as not empty", () => {
    const empty = initialDraft({ kind: "new", orderId, currency: "PEN" });
    expect(isEmptyDraft(empty)).toBe(true);
    expect(isEmptyDraft(setCustomer(empty, { name: "Ana", phone: "" }))).toBe(false);
    expect(isEmptyDraft(withDelivery(empty, { tab: "store" }))).toBe(false);
    expect(isEmptyDraft({ ...empty, draft: { ...empty.draft, deliverImmediately: true } })).toBe(false);
    expect(isEmptyDraft({ ...empty, draft: { ...empty.draft, payments: [{ paymentId: "p", amount: "", method: "bank_transfer", deductStockIfPartial: false }] } })).toBe(false);
  });

  test("never treats a saved order as empty", () => {
    expect(isEmptyDraft(savedState())).toBe(false);
  });
});

describe("edit request", () => {
  test("builds an edit request with only the changed parts and their pinned revisions", () => {
    const edited = typeQuantity(savedState(), deadpoolM, "2");
    expect(expectRequest(buildEditRequest(edited))).toEqual({
      operation: "save_changes",
      items: { base: revisions.items, lines: [{ variantId: trajeM, quantity: 1 }, { variantId: trajeL, quantity: 1 }, { variantId: deadpoolM, quantity: 2 }] },
    });
    const renamed = setCustomer(unmirrored(savedState()), { name: "Ana Pérez", phone: "+51977909427" });
    expect(expectRequest(buildEditRequest(renamed))).toEqual({ operation: "save_changes", customer: { base: revisions.customer, value: { name: "Ana Pérez", phone: "+51977909427" } } });
  });

  test("answers that there is nothing to save when no part differs", () => {
    const result = buildEditRequest(savedState());
    expect(result).toMatchObject({ success: false, error: { code: "NO_CHANGES" } });
  });

  test("refuses to build a request while a field is invalid", () => {
    expect(buildEditRequest(typeQuantity(savedState(), deadpoolM, ""))).toMatchObject({ success: false, error: { code: "INVALID_DRAFT" } });
  });

  test("sends a null customer when both fields are emptied", () => {
    const cleared = clearCustomer(savedState());
    expect(expectRequest(buildEditRequest(cleared)).customer).toEqual({ base: revisions.customer, value: null });
  });

  test("requires the customer of an order confirmed by the buyer, and not of one that was not", () => {
    const confirmed = savedState({ order: order1042({ checkoutEnabledAt: "2026-10-30T09:10:00.000Z", checkoutConfirmedAt: "2026-10-30T09:15:00.000Z" }) });
    expect(customerRequired(confirmed)).toBe(true);
    expect(customerRequired(savedState())).toBe(false);
    expect(customerRequired(initialDraft({ kind: "new", orderId, currency: "PEN" } as never))).toBe(false);
  });

  test("keeps clearing the customer a no-op and marks emptied fields on a buyer-confirmed order", () => {
    const confirmed = savedState({ order: order1042({ checkoutEnabledAt: "2026-10-30T09:10:00.000Z", checkoutConfirmedAt: "2026-10-30T09:15:00.000Z" }) });
    expect(clearCustomer(confirmed)).toBe(confirmed);
    const emptied = { ...confirmed, draft: { ...confirmed.draft, customer: { name: "", phone: "" } } };
    expect(invalidFields(emptied)).toContainEqual({ section: "customer", field: "customerName", reason: "customer_incomplete" });
    const changed = { ...confirmed, draft: { ...confirmed.draft, customer: { name: "Marta", phone: "+51999000111" } } };
    expect(invalidFields(changed).filter(mark => mark.section === "customer")).toEqual([]);
  });

  test("chooses amend when only the recipient, address or reference changed", () => {
    const edited = withDelivery(savedState(), { fields: { name: "Ana", address: "Jr. Cusco 10", instructions: "" } });
    expect(expectRequest(buildEditRequest(edited)).delivery).toEqual({ base: revisions.delivery, change: { kind: "amend", amendment: {
      method: "home", recipient: { name: "Ana", phone: "+51977909427", identity: { kind: "absent" } }, address: "Jr. Cusco 10", instructions: null } } });
  });

  test("chooses replace when the method, district, rate or agency changed", () => {
    const base = savedState();
    const rated = (fields: Partial<DeliveryDraft["fields"]>) => expectRequest(buildEditRequest(withDelivery(base, { fields: { ratePrice: pen(12), ...fields } }))).delivery?.change;
    expect(rated({ districtCode: "150101" })).toMatchObject({ kind: "replace", expectedPrice: pen(12), selection: { method: "home", rateId, destination: { districtCode: "150101" } } });
    expect(rated({ rateId: otherRateId })).toMatchObject({ kind: "replace", selection: { rateId: otherRateId } });
    const store = withDelivery(base, { tab: "store" });
    expect(expectRequest(buildEditRequest(store)).delivery?.change).toMatchObject({ kind: "replace", expectedPrice: pen(0), selection: { method: "store" } });
    const agency = withDelivery(base, { tab: "agency", fields: { agencyId: "00000000-0000-4000-8000-0000000000a9", ratePrice: pen(8), documentType: "national_id", document: "12345678" } });
    expect(expectRequest(buildEditRequest(agency)).delivery?.change).toMatchObject({ kind: "replace", selection: { method: "agency", agencyId: "00000000-0000-4000-8000-0000000000a9" } });
  });

  test("replaces a missing delivery with a quoted one on an order without delivery", () => {
    const bare = savedState({ order: order1042({ delivery: null }) });
    expect(bare.draft.delivery.tab).toBe("none");
    expect(unsavedParts(bare)).toEqual([]);
    const chosen = withDelivery(bare, { tab: "store" });
    expect(unsavedParts(chosen)).toEqual(["delivery"]);
    expect(expectRequest(buildEditRequest(chosen)).delivery?.change).toMatchObject({ kind: "replace", selection: { method: "store", recipient: { name: "Jorge Gonzalez" } } });
  });

  test("sends no delivery part when the customer changes on a shipped order with Igual que el cliente checked", () => {
    const shipped = savedState({ order: order1042({ deliveryStatus: "shipped", shippedAt: "2026-10-31T10:00:00.000Z", stockDeducted: true }) });
    expect(shipped.draft.delivery.sameAsCustomer).toBe(false);
    const renamed = setCustomer(shipped, { name: "Ana Pérez", phone: "+51988111222" });
    const request = expectRequest(buildEditRequest(renamed));
    expect(request.delivery).toBeUndefined();
    expect(request.customer?.value).toEqual({ name: "Ana Pérez", phone: "+51988111222" });
  });

  test("sends no delivery part when only the customer name changes on an order where another person receives", () => {
    const other = { ...recipient, name: "Marta Ríos", phone: "+51911222333" };
    const state = savedState({ order: order1042({ delivery: { ...homeDelivery, recipient: other } }) });
    expect(state.draft.delivery.sameAsCustomer).toBe(false);
    const request = expectRequest(buildEditRequest(setCustomer(state, { name: "Jorge G.", phone: "+51977909427" })));
    expect(request.delivery).toBeUndefined();
    expect(unsavedParts(setCustomer(state, { name: "Jorge G.", phone: "+51977909427" }))).toEqual(["customer"]);
  });

  test("mirrors the customer into the recipient while Igual que el cliente is checked", () => {
    const state = savedState();
    expect(state.draft.delivery.sameAsCustomer).toBe(true);
    const renamed = setCustomer(state, { name: "Ana Pérez", phone: "+51977909427" });
    expect(unsavedParts(renamed)).toEqual(["customer", "delivery"]);
    expect(expectRequest(buildEditRequest(renamed)).delivery?.change).toMatchObject({ kind: "amend", amendment: { recipient: { name: "Ana Pérez" } } });
  });

  test("unchecks Igual que el cliente and keeps the mirrored values when the customer is cleared", () => {
    const cleared = clearCustomer(savedState());
    expect(cleared.draft.customer).toEqual({ name: "", phone: "" });
    expect(cleared.draft.delivery.sameAsCustomer).toBe(false);
    expect(cleared.draft.delivery.fields).toMatchObject({ name: "Jorge Gonzalez", phone: "+51977909427" });
    expect(unsavedParts(cleared)).toEqual(["customer"]);
  });
});

describe("invalid fields", () => {
  test("marks an empty quantity, an incomplete delivery and a half-typed customer as invalid in screen order", () => {
    let state = savedState();
    state = withDelivery(state, { fields: { address: "" } });
    state = { ...state, draft: { ...state.draft, customer: { name: "Ana", phone: "" } } };
    state = typeQuantity(state, trajeL, "");
    state = { ...state, draft: { ...state.draft, delivery: { ...state.draft.delivery, sameAsCustomer: false } } };
    expect(invalidFields(state).map(({ section, field, id }) => [section, field, id])).toEqual([
      ["items", "quantity", trajeL],
      ["customer", "customerPhone", undefined],
      ["delivery", "address", undefined],
    ]);
  });

  test("marks a zero quantity and a quantity above the maximum", () => {
    const state = typeQuantity(typeQuantity(savedState(), trajeM, "0"), trajeL, "10000");
    expect(invalidFields(state)).toMatchObject([{ field: "quantity", id: trajeM, reason: "quantity_required" }, { field: "quantity", id: trajeL, reason: "quantity_max" }]);
  });

  test("marks the missing field of a customer with only a phone", () => {
    const state = { ...savedState(), draft: { ...savedState().draft, customer: { name: "", phone: "+51977909427" } } };
    expect(invalidFields(state)).toMatchObject([{ section: "customer", field: "customerName", reason: "customer_incomplete" }]);
  });

  test("requires a rate price, an agency and a document before a replaced delivery is valid", () => {
    const state = withDelivery(savedState(), { tab: "agency", fields: { rateId: "", agencyId: "" } });
    expect(invalidFields(state).map(({ field }) => field)).toEqual(["rateId", "agencyId", "document"]);
  });

  test("marks a saved order with more lines than the limit", () => {
    const start = savedState();
    const many = Array.from({ length: 101 }, (_, index) => newLine(`00000000-0000-4000-8000-${String(index + 1000).padStart(12, "0")}`));
    expect(invalidFields({ ...start, draft: { ...start.draft, items: many } })).toMatchObject([{ section: "items", field: "lines", reason: "too_many_lines" }]);
  });

  test("marks a saved order left without lines", () => {
    const start = savedState();
    expect(invalidFields({ ...start, draft: { ...start.draft, items: [] } })).toMatchObject([{ section: "items", field: "lines", reason: "lines_required" }]);
  });

  test("refuses to remove a saved delivery", () => {
    const state = withDelivery(savedState(), { tab: "none" });
    expect(invalidFields(state)).toMatchObject([{ section: "delivery", field: "tab", reason: "delivery_incomplete" }]);
  });

  test("ignores the delivery fields when the delivery is locked", () => {
    const shipped = savedState({ order: order1042({ deliveryStatus: "shipped", shippedAt: "2026-10-31T10:00:00.000Z", stockDeducted: true }) });
    expect(invalidFields(withDelivery(shipped, { fields: { address: "" } }))).toEqual([]);
  });

  test("marks a draft payment with an invalid amount and a deliver on save that the payments do not cover", () => {
    let state = initialDraft({ kind: "new", orderId, currency: "PEN" });
    state = { ...state, draft: { ...state.draft, items: [newLine(crown, "2")], deliverImmediately: true,
      payments: [{ paymentId: "p1", amount: "20.505", method: "digital_wallet", walletProvider: "yape", deductStockIfPartial: false }] } };
    expect(invalidFields(state)).toMatchObject([{ section: "payments", field: "amount", id: "p1" }, { section: "delivery", field: "deliverImmediately", reason: "deliver_needs_payment" }]);
  });
});

describe("estimate", () => {
  test("estimates totals using the saved price for a kept variant and the catalog price for a new one", () => {
    const start = savedState();
    // «Traje · M» removed and added again with the catalog price 95.00 keeps its saved 89.00; a new «Crown» takes 35.00.
    const edited = { ...start, draft: { ...start.draft, items: [
      { ...start.draft.items[0]!, unitPrice: pen(95), quantityText: "2" }, start.draft.items[2]!, newLine(crown, "3")] } };
    const result = estimate(edited);
    expect(result).toMatchObject({ success: true, data: { subtotal: pen(2 * 89 + 120 + 3 * 35), delivery: pen(0), paid: pen(150), total: pen(2 * 89 + 120 + 3 * 35), balance: pen(2 * 89 + 120 + 3 * 35 - 150), excess: pen(0) } });
  });

  test("shows the excess received when the payments exceed the total", () => {
    const start = savedState();
    const edited = { ...start, draft: { ...start.draft, items: [start.draft.items[2]!] } };
    expect(estimate(edited)).toMatchObject({ success: true, data: { total: pen(120), balance: pen(0), excess: pen(30) } });
  });

  test("adds the quoted price when the delivery is replaced and keeps the saved charge when only amended", () => {
    const amended = withDelivery(savedState(), { fields: { address: "Jr. Cusco 10" } });
    expect(estimate(amended)).toMatchObject({ data: { delivery: pen(0) } });
    const replaced = withDelivery(savedState(), { fields: { districtCode: "150101", ratePrice: pen(12) } });
    expect(estimate(replaced)).toMatchObject({ data: { delivery: pen(12), total: pen(310) } });
  });

  test("counts a line with an empty quantity as zero units", () => {
    expect(estimate(typeQuantity(savedState(), deadpoolM, ""))).toMatchObject({ data: { subtotal: pen(178) } });
  });

  test("sums the draft payments of a new sale", () => {
    let state = initialDraft({ kind: "new", orderId, currency: "PEN" });
    state = { ...state, draft: { ...state.draft, items: [newLine(crown, "2")],
      payments: [{ paymentId: "p1", amount: "30", method: "bank_transfer", deductStockIfPartial: false }, { paymentId: "p2", amount: "x", method: "bank_transfer", deductStockIfPartial: false }] } };
    expect(estimate(state)).toMatchObject({ data: { subtotal: pen(70), paid: pen(30), balance: pen(40) } });
  });
});

describe("screen locks", () => {
  test("locks products while stock is deducting, deducted, shipped or delivered", () => {
    const lock = (patch: Partial<OrderAggregateResponse>) => screenLocks(savedState({ order: order1042(patch) }));
    expect(lock({})).toEqual({ products: null, customer: null, delivery: null });
    expect(lock({ stockDue: { kind: "waiting", shortItems: [{ variantId: deadpoolM, available: 0 }] } }).products).toBeNull();
    expect(lock({ stockDue: { kind: "deducting" } })).toEqual({ products: "deducting", customer: null, delivery: null });
    expect(lock({ stockDeducted: true })).toEqual({ products: "deducted", customer: null, delivery: null });
    expect(lock({ stockDeducted: true, deliveryStatus: "shipped", shippedAt: "2026-10-31T10:00:00.000Z" })).toEqual({ products: "shipped", customer: null, delivery: "shipped" });
    expect(lock({ stockDeducted: true, deliveryStatus: "delivered", deliveredAt: "2026-10-31T10:00:00.000Z" })).toEqual({ products: "delivered", customer: null, delivery: "delivered" });
    expect(lock({ stockDeducted: true, deliveryStatus: "delivered", deliveredAt: "2026-10-31T10:00:00.000Z", status: "completed", completedAt: "2026-10-31T16:40:00.000Z" }).products).toBe("delivered");
  });

  test("locks every part of a cancelled order and nothing on a new sale", () => {
    expect(screenLocks(savedState({ order: order1042({ cancelled: true, status: "cancelled" }) }))).toEqual({ products: "cancelled", customer: "cancelled", delivery: "cancelled" });
    expect(screenLocks(initialDraft({ kind: "new", orderId, currency: "PEN" }))).toEqual({ products: null, customer: null, delivery: null });
  });
});

describe("line catalog", () => {
  test("shows no stock warning or no-longer-sold note when the line catalog is unknown", () => {
    const unknown = savedState({ lineCatalog: null });
    const raised = typeQuantity(unknown, deadpoolM, "9");
    expect(lineWarnings(raised, raised.draft.items[2]!)).toEqual({ availableStock: null, noLongerSold: false });
  });

  test("shows the stock warning on a line above its current stock", () => {
    const raised = typeQuantity(savedState(), deadpoolM, "5");
    expect(lineWarnings(raised, raised.draft.items[2]!)).toEqual({ availableStock: 4, noLongerSold: false });
    expect(lineWarnings(raised, raised.draft.items[0]!)).toEqual({ availableStock: null, noLongerSold: false });
  });

  test("shows the no-longer-sold note only when raising a line absent from the catalog", () => {
    const state = savedState({ lineCatalog: { [trajeM]: { stock: 5 }, [trajeL]: { stock: 2 } } });
    const untouched = state.draft.items[2]!;
    expect(untouched.sellable).toBe(false);
    expect(lineWarnings(state, untouched).noLongerSold).toBe(false);
    const raised = typeQuantity(state, deadpoolM, "2");
    expect(lineWarnings(raised, raised.draft.items[2]!).noLongerSold).toBe(true);
    const lowered = typeQuantity(typeQuantity(state, deadpoolM, "3"), deadpoolM, "1");
    expect(lineWarnings(lowered, lowered.draft.items[2]!).noLongerSold).toBe(false);
  });
});

describe("pinned base", () => {
  const chatChangedItems = order1042({ items: [order1042().items[0]!, order1042().items[2]!, item("00000000-0000-4000-8000-000000000009", crown, "Corona de Príncipe", "Única", 35)] });

  test("keeps the pinned items base and edits when a refresh after a void brings items changed by a chat message", () => {
    const edited = typeQuantity(savedState(), deadpoolM, "2");
    const refreshed = refreshFromLoader(edited, { order: chatChangedItems, revisions: { ...revisions, items: revision("Z") }, lineCatalog: catalog });
    expect(refreshed.base?.items.revision).toBe(revisions.items);
    expect(refreshed.draft.items.map((line) => [line.variantId, line.quantityText])).toEqual([[trajeM, "1"], [trajeL, "1"], [deadpoolM, "2"]]);
    expect(expectRequest(buildEditRequest(refreshed)).items?.base).toBe(revisions.items);
    expect(refreshed.loaded?.order.items).toHaveLength(3);
  });

  test("takes the refreshed customer when the customer has no unsaved edits", () => {
    const edited = typeQuantity(savedState(), deadpoolM, "2");
    const fresh = { order: order1042({ buyer: { contactId: null, name: "Ana Pérez", phone: "+51988111222" } }), revisions: { ...revisions, customer: revision("Y") }, lineCatalog: catalog };
    const refreshed = refreshFromLoader(edited, fresh);
    expect(refreshed.draft.customer).toEqual({ name: "Ana Pérez", phone: "+51988111222" });
    expect(refreshed.base?.customer.revision).toBe(revision("Y"));
    expect(refreshed.base?.items.revision).toBe(revisions.items);
    expect(unsavedParts(refreshed)).toEqual(["items"]);
  });

  test("keeps the edits of a part and takes the payments and totals from the loader", () => {
    const edited = typeQuantity(savedState(), deadpoolM, "2");
    const voided = order1042({ payments: [{ ...yape, status: "voided", data: { ...yape.data, voidedAt: "2026-10-30T11:00:00.000Z", voidedBy: "user-1" } }], paidAmount: pen(0), balanceDue: pen(298) });
    const refreshed = refreshFromLoader(edited, { order: voided, revisions, lineCatalog: { ...catalog, [deadpoolM]: { stock: 1 } } });
    expect(estimate(refreshed)).toMatchObject({ data: { paid: pen(0), balance: pen(418) } });
    expect(refreshed.draft.items[2]).toMatchObject({ quantityText: "2", stock: 1 });
    expect(lineWarnings(refreshed, refreshed.draft.items[2]!).availableStock).toBe(1);
  });

  test("re-pins a part whose draft equals the fresh state, as after an in-doubt save that went through", () => {
    const edited = typeQuantity(savedState(), deadpoolM, "2");
    const reread = order1042({ items: [order1042().items[0]!, order1042().items[1]!, item("00000000-0000-4000-8000-000000000003", deadpoolM, "Disfraz de Deadpool", "M", 120, 2)] });
    const refreshed = refreshFromLoader(edited, { order: reread, revisions: { ...revisions, items: revision("D") }, lineCatalog: catalog });
    expect(refreshed.base?.items.revision).toBe(revision("D"));
    expect(unsavedParts(refreshed)).toEqual([]);
    expect(expectRequest(buildEditRequest(typeQuantity(refreshed, deadpoolM, "3"))).items?.base).toBe(revision("D"));
  });

  test("stops mirroring the customer into the recipient when a refresh brings a shipped delivery", () => {
    const edited = setCustomer(savedState(), { name: "Ana Pérez", phone: "+51977909427" });
    expect(unsavedParts(edited)).toEqual(["customer", "delivery"]);
    const shipped = order1042({ deliveryStatus: "shipped", shippedAt: "2026-10-31T10:00:00.000Z", stockDeducted: true });
    const refreshed = refreshFromLoader(edited, { order: shipped, revisions, lineCatalog: catalog });
    expect(refreshed.draft.delivery.sameAsCustomer).toBe(false);
    const renamed = setCustomer(refreshed, { name: "Ana P", phone: "+51977909427" });
    expect(renamed.draft.delivery.fields.name).toBe("Ana Pérez");
  });

  test("does not mirror into a locked delivery even if the box is still checked", () => {
    const shipped = savedState({ order: order1042({ deliveryStatus: "shipped", shippedAt: "2026-10-31T10:00:00.000Z", stockDeducted: true }) });
    const checked = { ...shipped, draft: { ...shipped.draft, delivery: { ...shipped.draft.delivery, sameAsCustomer: true } } };
    expect(setCustomer(checked, { name: "Ana", phone: "+51988111222" }).draft.delivery.fields.name).toBe("Jorge Gonzalez");
  });

  test("keeps Igual que el cliente unchecked when a refresh takes the fresh delivery and the customer is kept", () => {
    const edited = setCustomer(unmirrored(savedState()), { name: "Ana", phone: "+51977909427" });
    const voided = order1042({ payments: [{ ...yape, status: "voided", data: { ...yape.data, voidedAt: "2026-10-30T11:00:00.000Z", voidedBy: "user-1" } }], paidAmount: pen(0), balanceDue: pen(298) });
    const refreshed = refreshFromLoader(edited, { order: voided, revisions, lineCatalog: catalog });
    expect(refreshed.draft.delivery.sameAsCustomer).toBe(false);
    const typing = setCustomer(refreshed, { name: "Ana P", phone: "+51977909427" });
    expect(unsavedParts(typing)).toEqual(["customer"]);
  });

  test("keeps the customer and delivery base revisions when products are reset after ITEMS_LOCKED", () => {
    let edited = typeQuantity(savedState(), deadpoolM, "2");
    edited = setCustomer(edited, { name: "Ana Pérez", phone: "+51977909427" });
    const fresh = { order: order1042({ stockDeducted: true }), revisions: { items: revision("X"), customer: revision("Y"), delivery: revision("W") }, lineCatalog: null };
    const reset = resetProducts(edited, fresh);
    expect(reset.draft.items.map((line) => line.quantityText)).toEqual(["1", "1", "1"]);
    expect(reset.base?.items.revision).toBe(revision("X"));
    expect(reset.base?.customer.revision).toBe(revisions.customer);
    expect(reset.base?.delivery.revision).toBe(revisions.delivery);
    expect(reset.draft.customer.name).toBe("Ana Pérez");
    expect(unsavedParts(reset)).toEqual(["customer", "delivery"]);
    expect(screenLocks(reset).products).toBe("deducted");
  });

  test("re-pins every part from a save result and clears the draft of the applied parts", () => {
    const edited = setCustomer(typeQuantity(savedState(), deadpoolM, "2"), { name: "Ana Pérez", phone: "+51977909427" });
    const savedOrder = order1042({ items: [order1042().items[0]!, order1042().items[1]!, item("00000000-0000-4000-8000-000000000003", deadpoolM, "Disfraz de Deadpool", "M", 120, 2)],
      buyer: { contactId: null, name: "Ana Pérez", phone: "+51977909427" }, delivery: { ...homeDelivery, recipient: { ...recipient, name: "Ana Pérez" } }, itemsTotal: pen(418), total: pen(418), balanceDue: pen(268) });
    const result: EditOrderResult = { order: savedOrder, revisions: { items: revision("D"), customer: revision("E"), delivery: revision("F") }, lineCatalog: catalog, applied: ["items", "customer", "delivery"] };
    const after = applySaveResult(edited, result);
    expect(unsavedParts(after)).toEqual([]);
    expect(after.base).toMatchObject({ items: { revision: revision("D") }, customer: { revision: revision("E") }, delivery: { revision: revision("F") } });
    expect(estimate(after)).toMatchObject({ data: { total: pen(418), balance: pen(268) } });
  });

  test("keeps the draft of a part that was not sent while taking the fresh state of the applied ones", () => {
    const edited = withDelivery(typeQuantity(savedState(), deadpoolM, "2"), { fields: { address: "Jr. Cusco 10" } });
    const savedOrder = order1042({ items: [order1042().items[0]!, order1042().items[1]!, item("00000000-0000-4000-8000-000000000003", deadpoolM, "Disfraz de Deadpool", "M", 120, 2)] });
    const after = applySaveResult(edited, { order: savedOrder, revisions: { ...revisions, items: revision("D") }, lineCatalog: catalog, applied: ["items"] });
    expect(unsavedParts(after)).toEqual(["delivery"]);
    expect(after.base?.delivery.revision).toBe(revisions.delivery);
    expect(after.base?.items.revision).toBe(revision("D"));
  });
});

describe("in-doubt check", () => {
  test("recognizes an applied save in the re-read order after an in-doubt answer", () => {
    const edited = typeQuantity(savedState(), deadpoolM, "2");
    const reread = order1042({ items: [order1042().items[0]!, order1042().items[1]!, item("00000000-0000-4000-8000-000000000003", deadpoolM, "Disfraz de Deadpool", "M", 120, 2)] });
    expect(inDoubtOutcome(reread, edited.draft, edited.base!)).toBe("applied");
  });

  test("answers not applied when the re-read order still equals the pinned base", () => {
    const edited = typeQuantity(savedState(), deadpoolM, "2");
    expect(inDoubtOutcome(order1042(), edited.draft, edited.base!)).toBe("not_applied");
  });

  test("answers changed after an in-doubt answer when a sent part matches neither the draft nor its pinned base", () => {
    const edited = typeQuantity(savedState(), deadpoolM, "2");
    const reread = order1042({ items: [order1042().items[0]!, order1042().items[2]!] });
    expect(inDoubtOutcome(reread, edited.draft, edited.base!)).toBe("changed");
    const other = order1042({ items: [order1042().items[0]!, order1042().items[1]!, item("00000000-0000-4000-8000-000000000003", deadpoolM, "Disfraz de Deadpool", "M", 120, 3)] });
    expect(inDoubtOutcome(other, edited.draft, edited.base!)).toBe("changed");
  });

  test("answers changed when one sent part was applied and another was not", () => {
    const edited = setCustomer(typeQuantity(savedState(), deadpoolM, "2"), { name: "Ana", phone: "+51988111222" });
    const reread = order1042({ items: [order1042().items[0]!, order1042().items[1]!, item("00000000-0000-4000-8000-000000000003", deadpoolM, "Disfraz de Deadpool", "M", 120, 2)] });
    expect(inDoubtOutcome(reread, edited.draft, edited.base!)).toBe("changed");
  });
});

describe("create request", () => {
  test("builds the creation request of a new sale with its draft payments and customer", () => {
    let state = initialDraft({ kind: "new", orderId, currency: "PEN" });
    state = { ...state, draft: { ...state.draft, items: [newLine(crown, "2")], customer: { name: "Ana", phone: "+51988111222" },
      payments: [{ paymentId: "00000000-0000-4000-8000-0000000000aa", amount: "30", method: "digital_wallet", walletProvider: "yape", deductStockIfPartial: false }] } };
    const result = buildCreateRequest(state);
    expect(result).toMatchObject({ success: true, data: {
      id: orderId, items: [{ variantId: crown, quantity: 2 }], customer: { name: "Ana", phone: "+51988111222" },
      payments: [{ paymentId: "00000000-0000-4000-8000-0000000000aa", amount: pen(30), method: "digital_wallet", walletProvider: "yape", deductStockIfPartial: false }] } });
    expect(result.success && "delivery" in result.data).toBe(false);
  });

  test("starts a new sale at Por definir and sends no delivery", () => {
    const state = initialDraft({ kind: "new", orderId, currency: "PEN" });
    expect(state.draft.delivery.tab).toBe("none");
    expect(state.base).toBeNull();
    expect(unsavedParts(state)).toEqual([]);
    expect(buildCreateRequest({ ...state, draft: { ...state.draft, items: [newLine(crown)] } })).toMatchObject({ success: true });
  });

  test("sends a chosen delivery with its expected price and mirrors the customer into the recipient", () => {
    let state = initialDraft({ kind: "new", orderId, currency: "PEN" });
    state = setCustomer({ ...state, draft: { ...state.draft, items: [newLine(crown)] } }, { name: "Ana", phone: "+51988111222" });
    state = withDelivery(state, { tab: "store" });
    expect(buildCreateRequest(state)).toMatchObject({ success: true, data: { delivery: { expectedPrice: pen(0), delivery: { method: "store", recipient: { name: "Ana", phone: "+51988111222" } } } } });
  });

  test("refuses to build a request without products or with an invalid field", () => {
    const state = initialDraft({ kind: "new", orderId, currency: "PEN" });
    expect(buildCreateRequest(state)).toMatchObject({ success: false, error: { code: "INVALID_DRAFT" } });
    const half = { ...state, draft: { ...state.draft, items: [newLine(crown)], customer: { name: "Ana", phone: "" } } };
    expect(buildCreateRequest(half)).toMatchObject({ success: false, error: { code: "INVALID_DRAFT" } });
  });
});
