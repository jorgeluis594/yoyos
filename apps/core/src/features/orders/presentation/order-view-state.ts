import { completeOrderSchema, newOrderCustomerSchema, ratedDeliverySelectionSchema, type CompleteOrderRequest, type OrderAggregateResponse } from "@shared/contracts/orders";
import { err, ok } from "@shared/functional";
import { add, multiply, subtract, type Currency, type Money, type MoneyError } from "@shared/money";
import { maxOrderLineQuantity, maxOrderLines } from "@shared/orders-edit";
import type { Result } from "@shared/result";
import type { WalletProvider } from "@shared/wallet-providers";
import type { OrderPart } from "@core/src/features/orders/domain/order-edit";
import { editOrderRequestSchema, type EditOrderRequest, type EditOrderResult } from "@core/src/features/orders/presentation/order-edit-schemas";

/**
 * Pure model of the order view: the seller's draft, the saved state it was loaded from (pinned per part), and the rules
 * that derive from them. Advisory only: core is the authority on locks, conflicts, prices and totals.
 */

type Order = OrderAggregateResponse;
type Revisions = EditOrderResult["revisions"];
type LineCatalog = EditOrderResult["lineCatalog"];
type Delivery = NonNullable<Order["delivery"]>;

export type DeliveryTab = "none" | "home" | "agency" | "store";
export type DocumentType = "absent" | "national_id" | "passport" | "foreign_id";

/** One line of the products card. A saved line keeps its saved price; a line from the picker carries the catalog price. */
export type DraftLine = Readonly<{
  variantId: string; productName: string; attributes: Readonly<Record<string, string>>; sku: string | null; unitPrice: Money;
  /** What the seller typed: the quantity is only valid once it parses as a whole number from 1 to the maximum. */
  quantityText: string;
  /** Stock shown for the line; `null` when unknown or when the variant is no longer sold. */
  stock: number | null;
  /** False when the line catalog says the variant is no longer sold. */
  sellable: boolean;
}>;
export type CustomerDraft = Readonly<{ name: string; phone: string }>;
export type DeliveryFields = Readonly<{
  districtCode: string | null; rateId: string; agencyId: string;
  /** Price of the chosen rate, set by the delivery card once the quotation arrives. A store pickup costs nothing and needs none. */
  ratePrice: Money | null;
  name: string; phone: string; documentType: DocumentType; document: string; address: string; instructions: string;
}>;
export type DeliveryDraft = Readonly<{ tab: DeliveryTab; fields: DeliveryFields; sameAsCustomer: boolean }>;
export type PaymentRow = Readonly<{
  paymentId: string; amount: string; method: "digital_wallet" | "bank_transfer"; walletProvider?: WalletProvider; deductStockIfPartial: boolean;
}>;

/** What the seller is editing, for a new sale or a saved order. Payments and `deliverImmediately` only matter on a new sale. */
export type OrderViewDraft = Readonly<{
  orderId: string; currency: Currency; items: readonly DraftLine[]; customer: CustomerDraft; delivery: DeliveryDraft;
  payments: readonly PaymentRow[]; deliverImmediately: boolean;
}>;

type Parts = Readonly<{ items: readonly DraftLine[]; customer: CustomerDraft; delivery: DeliveryDraft }>;
type PartBase<T> = Readonly<{ saved: T; revision: string }>;
/** The saved state and revision each part was loaded with. It moves only as §6.4 of the design says. */
export type ViewBase = Readonly<{ items: PartBase<readonly DraftLine[]>; customer: PartBase<CustomerDraft>; delivery: PartBase<DeliveryDraft> }>;
export type LoadedOrder = Readonly<{ order: Order; revisions: Revisions; lineCatalog: LineCatalog }>;
export type OrderViewState = Readonly<{
  draft: OrderViewDraft; base: ViewBase | null; loaded: LoadedOrder | null;
  /** Grows when a refused save leaves the delivery rate stale: the place fields quote again, so the next save sends a fresh rate. */
  quoteEpoch?: number;
}>;
export type DraftSource =
  | Readonly<{ kind: "new"; orderId: string; currency: Currency }>
  | (Readonly<{ kind: "saved" }> & LoadedOrder);

export type RequestError = Readonly<{ code: "INVALID_DRAFT" | "NO_CHANGES"; message: string }>;

const parts = ["items", "customer", "delivery"] as const satisfies readonly OrderPart[];
const invalid = (message: string) => err({ code: "INVALID_DRAFT", message } as const);

// ---------------------------------------------------------------------------------------------------------------------
// Saved state to draft

const blankFields = (customer: CustomerDraft): DeliveryFields => ({ districtCode: null, rateId: "", agencyId: "", ratePrice: null,
  name: customer.name, phone: customer.phone, documentType: "absent", document: "", address: "", instructions: "" });

const digits = (phone: string) => phone.replace(/\D/g, "");
const customerOf = (order: Order): CustomerDraft => ({ name: order.buyer?.name ?? "", phone: order.buyer?.phone ?? "" });
const deliveryLocked = (order: Order) => order.cancelled || order.deliveryStatus !== "pending";

function linesOf(order: Order, lineCatalog: LineCatalog): readonly DraftLine[] {
  return order.items.map((item) => {
    const entry = lineCatalog === null ? undefined : lineCatalog[item.variantId];
    return { variantId: item.variantId, productName: item.productName, attributes: item.variantAttributes, sku: item.sku, unitPrice: item.unitPrice,
      quantityText: String(item.quantity), stock: entry?.stock ?? null, sellable: lineCatalog === null || entry !== undefined };
  });
}

function deliveryFieldsOf(delivery: Delivery): DeliveryFields {
  const identity = delivery.recipient.identity;
  const common = { ratePrice: null, name: delivery.recipient.name, phone: delivery.recipient.phone,
    documentType: identity.kind === "document" ? identity.documentType : "absent" as const, document: identity.kind === "document" ? identity.document : "" };
  if (delivery.method === "home") return { ...common, districtCode: delivery.destination.districtCode, rateId: delivery.pricing.rateId, agencyId: "",
    address: delivery.destination.address, instructions: delivery.destination.instructions ?? "" };
  if (delivery.method === "agency") return { ...common, districtCode: delivery.destination.districtCode, rateId: delivery.pricing.rateId, agencyId: delivery.agency.id, address: "", instructions: "" };
  return { ...common, districtCode: null, rateId: "", agencyId: "", address: "", instructions: "" };
}

function deliveryOf(order: Order, customer: CustomerDraft): DeliveryDraft {
  const mirrors = !deliveryLocked(order);
  if (!order.delivery) return { tab: "none", fields: blankFields(customer), sameAsCustomer: mirrors };
  const fields = deliveryFieldsOf(order.delivery);
  const sameAsCustomer = mirrors && fields.name === customer.name && digits(fields.phone) === digits(customer.phone);
  return { tab: order.delivery.method, fields, sameAsCustomer };
}

function partsOf({ order, lineCatalog }: Pick<LoadedOrder, "order" | "lineCatalog">): Parts {
  const customer = customerOf(order);
  return { items: linesOf(order, lineCatalog), customer, delivery: deliveryOf(order, customer) };
}

const baseOf = (saved: Parts, revisions: Revisions): ViewBase => ({ items: { saved: saved.items, revision: revisions.items },
  customer: { saved: saved.customer, revision: revisions.customer }, delivery: { saved: saved.delivery, revision: revisions.delivery } });

export function initialDraft(source: DraftSource): OrderViewState {
  if (source.kind === "new") {
    const customer = { name: "", phone: "" };
    return { loaded: null, base: null, draft: { orderId: source.orderId, currency: source.currency, items: [], customer,
      delivery: { tab: "none", fields: blankFields(customer), sameAsCustomer: true }, payments: [], deliverImmediately: false } };
  }
  const saved = partsOf(source);
  return { loaded: { order: source.order, revisions: source.revisions, lineCatalog: source.lineCatalog }, base: baseOf(saved, source.revisions),
    draft: { orderId: source.order.id, currency: source.order.total.currency, payments: [], deliverImmediately: false, ...saved } };
}

// ---------------------------------------------------------------------------------------------------------------------
// Unsaved changes

/** A new sale with nothing typed or chosen: **Descartar** is disabled and leaving needs no confirmation. A saved order is never empty. */
export function isEmptyDraft(state: OrderViewState): boolean {
  const { draft } = state;
  return state.base === null && draft.items.length === 0 && draft.payments.length === 0 && !draft.deliverImmediately
    && draft.customer.name.trim() === "" && draft.customer.phone.trim() === "" && draft.delivery.tab === "none";
}

const quantityOf = (line: DraftLine): number | null => {
  const text = line.quantityText.trim();
  if (!/^\d+$/.test(text)) return null;
  const quantity = Number(text);
  return quantity >= 1 && quantity <= maxOrderLineQuantity ? quantity : null;
};
const identityKey = (fields: DeliveryFields) => fields.documentType === "absent" ? "absent" : `${fields.documentType}:${fields.document.trim()}`;

/** Canonical content of a part, so that equal content means no unsaved change whatever the order of the lines or the typed leading zeros. */
function keyOf(part: OrderPart, value: Parts): string {
  if (part === "items") return JSON.stringify(value.items.map((line) => [line.variantId, /^\d+$/.test(line.quantityText.trim()) ? Number(line.quantityText) : line.quantityText]).sort());
  if (part === "customer") return JSON.stringify([value.customer.name.trim(), value.customer.phone.trim()]);
  const { tab, fields } = value.delivery;
  if (tab === "none") return "none";
  const recipient = [fields.name.trim(), fields.phone.trim(), identityKey(fields)];
  if (tab === "store") return JSON.stringify([tab, recipient]);
  const place = [fields.districtCode, fields.rateId];
  return JSON.stringify(tab === "home" ? [tab, recipient, place, fields.address.trim(), fields.instructions.trim()] : [tab, recipient, place, fields.agencyId]);
}

const partsOfState = (state: OrderViewState): Parts => state.draft;
const savedParts = (base: ViewBase): Parts => ({ items: base.items.saved, customer: base.customer.saved, delivery: base.delivery.saved });
const isEdited = (part: OrderPart, draft: Parts, base: ViewBase) => keyOf(part, draft) !== keyOf(part, savedParts(base));

/** Parts whose draft differs from the saved state, in screen order. A new sale has no saved state, so none. */
export function unsavedParts(state: OrderViewState): readonly OrderPart[] {
  const base = state.base;
  return base === null ? [] : parts.filter((part) => isEdited(part, partsOfState(state), base));
}

// ---------------------------------------------------------------------------------------------------------------------
// Customer

/** While «Igual que el cliente» is checked, the recipient mirrors the customer. A locked delivery never mirrors, whatever the box says. */
export function setCustomer(state: OrderViewState, customer: CustomerDraft): OrderViewState {
  const { delivery } = state.draft;
  const next = delivery.sameAsCustomer && screenLocks(state).delivery === null ? { ...delivery, fields: { ...delivery.fields, name: customer.name, phone: customer.phone } } : delivery;
  return { ...state, draft: { ...state.draft, customer, delivery: next } };
}

/** A saved order the buyer confirmed keeps a customer: the seller can change it but not leave it empty. */
export function customerRequired(state: OrderViewState): boolean {
  return state.loaded?.order.checkoutConfirmedAt != null;
}

/** «Quitar cliente»: both fields are emptied, and the recipient keeps the last values it mirrored. It does nothing when the customer is required. */
export function clearCustomer(state: OrderViewState): OrderViewState {
  if (customerRequired(state)) return state;
  const { delivery } = state.draft;
  return { ...state, draft: { ...state.draft, customer: { name: "", phone: "" }, delivery: { ...delivery, sameAsCustomer: false } } };
}

// ---------------------------------------------------------------------------------------------------------------------
// Locks and line warnings

export type ProductsLock = "cancelled" | "delivered" | "shipped" | "deducting" | "deducted";
export type ScreenLocks = Readonly<{ products: ProductsLock | null; customer: "cancelled" | null; delivery: "cancelled" | "delivered" | "shipped" | null }>;

/** What the screen disables. «Descontando stock» is a screen rule only; core enforces the rest. */
export function screenLocks(state: OrderViewState): ScreenLocks {
  const order = state.loaded?.order;
  if (!order) return { products: null, customer: null, delivery: null };
  if (order.cancelled) return { products: "cancelled", customer: "cancelled", delivery: "cancelled" };
  const delivery = order.deliveryStatus === "pending" ? null : order.deliveryStatus;
  const products: ProductsLock | null = delivery ?? (order.stockDue?.kind === "deducting" ? "deducting" : order.stockDeducted ? "deducted" : null);
  return { products, customer: null, delivery };
}

/** The stock warning applies when the quantity exceeds a known stock; the note applies when raising a line the catalog no longer sells. */
export function lineWarnings(state: OrderViewState, line: DraftLine): Readonly<{ availableStock: number | null; noLongerSold: boolean }> {
  const quantity = quantityOf(line);
  const availableStock = line.stock !== null && quantity !== null && quantity > line.stock ? line.stock : null;
  const savedLine = state.base?.items.saved.find((candidate) => candidate.variantId === line.variantId);
  const savedQuantity = savedLine ? quantityOf(savedLine) ?? 0 : 0;
  return { availableStock, noLongerSold: !line.sellable && savedLine !== undefined && quantity !== null && quantity > savedQuantity };
}

// ---------------------------------------------------------------------------------------------------------------------
// Estimate

export type Estimate = Readonly<{ subtotal: Money; delivery: Money; paid: Money; total: Money; balance: Money; excess: Money }>;

const isValidAmount = (amount: string) => /^\d+(\.\d{1,2})?$/.test(amount.trim()) && Number(amount) >= 0.01;
const zero = (currency: Currency): Money => ({ amount: 0, currency });

/** A kept variant is priced at its saved price, also when the seller removed it and added it again. */
function priceOf(line: DraftLine, base: ViewBase | null): Money {
  return base?.items.saved.find((saved) => saved.variantId === line.variantId)?.unitPrice ?? line.unitPrice;
}

type DeliveryChange = "replace" | "amend";
function deliveryChangeOf(draft: DeliveryDraft, base: ViewBase): DeliveryChange {
  const saved = base.delivery.saved;
  if (saved.tab === "none" || saved.tab !== draft.tab) return "replace";
  if (draft.tab === "store") return "amend";
  const [now, before] = [draft.fields, saved.fields];
  return now.districtCode !== before.districtCode || now.rateId !== before.rateId || (draft.tab === "agency" && now.agencyId !== before.agencyId) ? "replace" : "amend";
}

function deliveryCharge(state: OrderViewState, currency: Currency): Money {
  const { delivery } = state.draft;
  const savedCharge = state.loaded?.order.deliveryCharge ?? zero(currency);
  if (delivery.tab === "store") return zero(currency);
  if (state.base === null) return delivery.tab === "none" ? zero(currency) : delivery.fields.ratePrice ?? zero(currency);
  if (delivery.tab === "none" || screenLocks(state).delivery !== null || deliveryChangeOf(delivery, state.base) === "amend") return savedCharge;
  return delivery.fields.ratePrice ?? savedCharge;
}

function sumPaid(state: OrderViewState, currency: Currency): Result<Money, MoneyError> {
  if (state.loaded) return ok(state.loaded.order.paidAmount);
  return state.draft.payments.reduce<Result<Money, MoneyError>>((sum, payment) => {
    if (!sum.success || !isValidAmount(payment.amount)) return sum;
    return add({ amount: Number(payment.amount), currency })(sum.data);
  }, ok(zero(currency)));
}

/** Subtotal, delivery, paid, total and balance or excess of what is on screen, with `shared/money`. Core recalculates on save. */
export function estimate(state: OrderViewState): Result<Estimate, MoneyError> {
  const currency = state.loaded?.order.total.currency ?? state.draft.currency;
  let subtotal: Result<Money, MoneyError> = ok(zero(currency));
  for (const line of state.draft.items) {
    if (!subtotal.success) return subtotal;
    const lineTotal = multiply(priceOf(line, state.base))(quantityOf(line) ?? 0);
    subtotal = lineTotal.success ? add(lineTotal.data)(subtotal.data) : lineTotal;
  }
  if (!subtotal.success) return subtotal;
  const delivery = deliveryCharge(state, currency);
  const total = add(delivery)(subtotal.data);
  const paid = sumPaid(state, currency);
  if (!total.success) return total;
  if (!paid.success) return paid;
  const owed = subtract(paid.data)(total.data);
  if (!owed.success) return owed;
  const balance = owed.data.amount > 0 ? owed.data : zero(currency);
  const excess = owed.data.amount < 0 ? multiply(owed.data)(-1) : ok(zero(currency));
  if (!excess.success) return excess;
  return ok({ subtotal: subtotal.data, delivery, paid: paid.data, total: total.data, balance, excess: excess.data });
}

// ---------------------------------------------------------------------------------------------------------------------
// Invalid fields

export type InvalidReason = "quantity_required" | "quantity_max" | "currency_mismatch" | "too_many_lines" | "lines_required" | "amount_invalid"
  | "customer_incomplete" | "customer_invalid" | "delivery_incomplete" | "deliver_needs_payment";
/** A field the save refuses, in screen order. `id` names the line (its variant) or the draft payment. */
export type InvalidField = Readonly<{ section: "items" | "payments" | "customer" | "delivery"; field: string; id?: string; reason: InvalidReason }>;

function invalidItems(state: OrderViewState): readonly InvalidField[] {
  const marks: InvalidField[] = [];
  for (const line of state.draft.items) {
    if (line.unitPrice.currency !== state.draft.currency) marks.push({ section: "items", field: "line", id: line.variantId, reason: "currency_mismatch" });
    else if (quantityOf(line) === null) {
      const typed = Number(line.quantityText.trim());
      marks.push({ section: "items", field: "quantity", id: line.variantId, reason: /^\d+$/.test(line.quantityText.trim()) && typed > maxOrderLineQuantity ? "quantity_max" : "quantity_required" });
    }
  }
  if (state.base !== null && state.draft.items.length > maxOrderLines) marks.push({ section: "items", field: "lines", reason: "too_many_lines" });
  if (state.base !== null && state.draft.items.length === 0) marks.push({ section: "items", field: "lines", reason: "lines_required" });
  return marks;
}

function invalidCustomer(customer: CustomerDraft, required: boolean): readonly InvalidField[] {
  const [name, phone] = [customer.name.trim(), customer.phone.trim()];
  if (name === "" && phone === "") return required ? [{ section: "customer", field: "customerName", reason: "customer_incomplete" }] : [];
  if (name === "" || phone === "") return [{ section: "customer", field: name === "" ? "customerName" : "customerPhone", reason: "customer_incomplete" }];
  const parsed = newOrderCustomerSchema.safeParse({ name, phone });
  if (parsed.success) return [];
  const paths = new Set(parsed.error.issues.map((issue) => issue.path[0]));
  return [...(paths.has("name") ? ["customerName"] : []), ...(paths.has("phone") ? ["customerPhone"] : [])]
    .map((field) => ({ section: "customer", field, reason: "customer_invalid" }));
}

function invalidDelivery(delivery: DeliveryDraft, base: ViewBase | null): readonly InvalidField[] {
  const mark = (field: string): InvalidField => ({ section: "delivery", field, reason: "delivery_incomplete" });
  const { tab, fields } = delivery;
  if (tab === "none") return base !== null && base.delivery.saved.tab !== "none" ? [mark("tab")] : [];
  const quoted = tab !== "store";
  const replaces = base === null || deliveryChangeOf(delivery, base) === "replace";
  const missing = [
    ...(quoted && !fields.districtCode ? ["districtCode"] : []),
    ...(quoted && (!fields.rateId || (replaces && fields.ratePrice === null)) ? ["rateId"] : []),
    ...(tab === "agency" && !fields.agencyId ? ["agencyId"] : []),
    ...(fields.name.trim() === "" ? ["name"] : []), ...(fields.phone.trim() === "" ? ["phone"] : []),
    ...(tab === "home" && fields.address.trim() === "" ? ["address"] : []),
    ...((tab === "agency" && fields.documentType === "absent") || (fields.documentType !== "absent" && fields.document.trim() === "") ? ["document"] : []),
  ];
  return missing.map(mark);
}

/** Invalid fields in screen order: products, payments, customer, delivery. The save buttons stay enabled and focus the first one. */
export function invalidFields(state: OrderViewState): readonly InvalidField[] {
  const { draft, base } = state;
  const locks = screenLocks(state);
  const edited = unsavedParts(state);
  const payments = draft.payments.filter((payment) => !isValidAmount(payment.amount))
    .map((payment): InvalidField => ({ section: "payments", field: "amount", id: payment.paymentId, reason: "amount_invalid" }));
  const customer = locks.customer === null && (base === null || edited.includes("customer")) ? invalidCustomer(draft.customer, customerRequired(state)) : [];
  const delivery = locks.delivery === null && (base === null || edited.includes("delivery")) ? invalidDelivery(draft.delivery, base) : [];
  const estimated = estimate(state);
  const uncovered = base === null && draft.deliverImmediately && !(estimated.success && estimated.data.balance.amount === 0);
  const deliverNow: readonly InvalidField[] = uncovered ? [{ section: "delivery", field: "deliverImmediately", reason: "deliver_needs_payment" }] : [];
  return [...invalidItems(state), ...payments, ...customer, ...delivery, ...deliverNow];
}

// ---------------------------------------------------------------------------------------------------------------------
// Requests

function recipientOf(fields: DeliveryFields) {
  return { name: fields.name.trim(), phone: fields.phone.trim(),
    identity: fields.documentType === "absent" ? { kind: "absent" } : { kind: "document", documentType: fields.documentType, document: fields.document.trim() } };
}

function selectionOf(delivery: DeliveryDraft) {
  const { tab, fields } = delivery;
  const recipient = recipientOf(fields);
  return ratedDeliverySelectionSchema.safeParse(tab === "store" ? { method: "store", recipient }
    : tab === "home" ? { method: "home", recipient, rateId: fields.rateId, destination: { districtCode: fields.districtCode, address: fields.address.trim(), instructions: fields.instructions.trim() || null } }
    : { method: "agency", recipient, rateId: fields.rateId, districtCode: fields.districtCode, agencyId: fields.agencyId });
}

/** Price the seller saw for the chosen rate; a store pickup is free. */
const expectedPriceOf = (delivery: DeliveryDraft, currency: Currency): Money | null => delivery.tab === "store" ? zero(currency) : delivery.fields.ratePrice;

function amendmentOf(delivery: DeliveryDraft) {
  const { tab, fields } = delivery;
  const recipient = recipientOf(fields);
  return tab === "home" ? { method: "home", recipient, address: fields.address.trim(), instructions: fields.instructions.trim() }
    : { method: tab, recipient };
}

const customerValueOf = (customer: CustomerDraft) => customer.name.trim() === "" && customer.phone.trim() === "" ? null : { name: customer.name.trim(), phone: customer.phone.trim() };

function deliveryRequest(delivery: DeliveryDraft, base: ViewBase, currency: Currency): Result<unknown, RequestError> {
  const pinned = { base: base.delivery.revision };
  if (deliveryChangeOf(delivery, base) === "amend") return ok({ ...pinned, change: { kind: "amend", amendment: amendmentOf(delivery) } });
  const selection = selectionOf(delivery);
  const expectedPrice = expectedPriceOf(delivery, currency);
  if (!selection.success || expectedPrice === null) return invalid("The delivery is incomplete");
  return ok({ ...pinned, change: { kind: "replace", selection: selection.data, expectedPrice } });
}

/** The request of **Guardar cambios**: only the parts that differ, each with the revision it was pinned with. */
export function buildEditRequest(state: OrderViewState): Result<EditOrderRequest, RequestError> {
  const { draft, base } = state;
  const edited = unsavedParts(state);
  if (base === null || edited.length === 0) return err({ code: "NO_CHANGES", message: "There is nothing to save" });
  if (invalidFields(state).length > 0) return invalid("A field is invalid");
  const body: Record<string, unknown> = { operation: "save_changes" };
  if (edited.includes("items")) body.items = { base: base.items.revision, lines: draft.items.map((line) => ({ variantId: line.variantId, quantity: quantityOf(line) })) };
  if (edited.includes("customer")) body.customer = { base: base.customer.revision, value: customerValueOf(draft.customer) };
  if (edited.includes("delivery")) {
    const delivery = deliveryRequest(draft.delivery, base, draft.currency);
    if (!delivery.success) return delivery;
    body.delivery = delivery.data;
  }
  const parsed = editOrderRequestSchema.safeParse(body);
  return parsed.success ? ok(parsed.data) : invalid("The request does not pass its schema");
}

/** The request of **Guardar venta**, for `completeOrderSchema`. */
export function buildCreateRequest(state: OrderViewState): Result<CompleteOrderRequest, RequestError> {
  const { draft } = state;
  if (draft.items.length === 0 || invalidFields(state).length > 0) return invalid("The sale is incomplete");
  const customer = customerValueOf(draft.customer);
  let delivery: Record<string, unknown> | undefined;
  if (draft.delivery.tab !== "none") {
    const selection = selectionOf(draft.delivery);
    const expectedPrice = expectedPriceOf(draft.delivery, draft.currency);
    if (!selection.success || expectedPrice === null) return invalid("The delivery is incomplete");
    delivery = { delivery: selection.data, expectedPrice };
  }
  const parsed = completeOrderSchema.safeParse({
    id: draft.orderId, items: draft.items.map((line) => ({ variantId: line.variantId, quantity: quantityOf(line) })),
    ...(customer ? { customer } : {}),
    ...(draft.payments.length > 0 ? { payments: draft.payments.map((payment) => ({ paymentId: payment.paymentId, amount: { amount: Number(payment.amount), currency: draft.currency },
      method: payment.method, ...(payment.walletProvider ? { walletProvider: payment.walletProvider } : {}), deductStockIfPartial: payment.deductStockIfPartial })) } : {}),
    ...(delivery ? { delivery } : {}), ...(draft.deliverImmediately ? { deliverImmediately: true } : {}),
  });
  return parsed.success ? ok(parsed.data) : invalid("The request does not pass its schema");
}

// ---------------------------------------------------------------------------------------------------------------------
// Refresh, save result, reset and discard

/** Applies the fresh saved state to the parts `takeFresh` selects. The other parts keep their draft and their pinned base. */
function pin(state: OrderViewState, fresh: LoadedOrder, takeFresh: (part: OrderPart, edited: boolean, sameAsFresh: boolean) => boolean): OrderViewState {
  const { base } = state;
  if (base === null) return state;
  const saved = partsOf(fresh);
  const freshBase = baseOf(saved, fresh.revisions);
  const take = new Set(parts.filter((part) => takeFresh(part, isEdited(part, state.draft, base), keyOf(part, state.draft) === keyOf(part, saved))));
  const known = new Set([...fresh.order.items.map((item) => item.variantId), ...base.items.saved.map((line) => line.variantId)]);
  const kept = state.draft.items.map((line) => {
    if (!known.has(line.variantId)) return line;
    const entry = fresh.lineCatalog === null ? undefined : fresh.lineCatalog[line.variantId];
    return { ...line, stock: entry?.stock ?? null, sellable: fresh.lineCatalog === null || entry !== undefined };
  });
  // A kept delivery draft stops mirroring once the fresh order locks the delivery; a fresh one keeps the box the seller left while the customer draft is kept.
  const delivery = take.has("delivery") ? { ...saved.delivery, sameAsCustomer: take.has("customer") ? saved.delivery.sameAsCustomer : !deliveryLocked(fresh.order) && state.draft.delivery.sameAsCustomer }
    : { ...state.draft.delivery, sameAsCustomer: !deliveryLocked(fresh.order) && state.draft.delivery.sameAsCustomer };
  return { loaded: fresh, base: {
    items: take.has("items") ? freshBase.items : base.items, customer: take.has("customer") ? freshBase.customer : base.customer,
    delivery: take.has("delivery") ? freshBase.delivery : base.delivery },
  draft: { ...state.draft, items: take.has("items") ? saved.items : kept, customer: take.has("customer") ? saved.customer : state.draft.customer,
    delivery } };
}

/**
 * After a payment action or any revalidation: a part without unsaved edits, or whose draft already equals the fresh state (an in-doubt save that went through),
 * takes the fresh state and revision; any other edited part keeps both.
 */
export function refreshFromLoader(state: OrderViewState, fresh: LoadedOrder): OrderViewState {
  return pin(state, fresh, (_part, edited, sameAsFresh) => !edited || sameAsFresh);
}

/** After a successful **Guardar cambios**: every part is pinned again, except one with edits that were not sent. */
export function applySaveResult(state: OrderViewState, result: EditOrderResult): OrderViewState {
  const { applied, ...fresh } = result;
  return pin(state, fresh, (part, edited, sameAsFresh) => applied.includes(part) || !edited || sameAsFresh);
}

/** After `ITEMS_LOCKED`: the products return to the fresh saved ones; the customer and the delivery keep their edits and their pinned base. */
export function resetProducts(state: OrderViewState, fresh: LoadedOrder): OrderViewState {
  return pin(state, fresh, (part, edited) => part === "items" || !edited);
}

/** **Descartar y recargar**: every part takes the fresh state and revision. */
export function reloadAll(state: OrderViewState, fresh: LoadedOrder): OrderViewState {
  return pin(state, fresh, () => true);
}

/** **Descartar cambios**: the given parts (all by default) return to their pinned saved state. */
export function discardChanges(state: OrderViewState, only: readonly OrderPart[] = parts): OrderViewState {
  const { base } = state;
  if (base === null) return state;
  const saved = savedParts(base);
  return { ...state, draft: { ...state.draft, items: only.includes("items") ? saved.items : state.draft.items,
    customer: only.includes("customer") ? saved.customer : state.draft.customer, delivery: only.includes("delivery") ? saved.delivery : state.draft.delivery } };
}

// ---------------------------------------------------------------------------------------------------------------------
// In-doubt check

export type InDoubtOutcome = "applied" | "not_applied" | "changed";

/**
 * Compares the re-read order with each part that was sent. All of them equal to the draft: applied. All equal to the pinned saved state:
 * not applied. Anything else, also a mix, was changed by someone else.
 */
export function inDoubtOutcome(reread: Order, draft: OrderViewDraft, base: ViewBase): InDoubtOutcome {
  const current = partsOf({ order: reread, lineCatalog: null });
  const sent = parts.filter((part) => isEdited(part, draft, base));
  const outcomes = sent.map((part) => keyOf(part, current) === keyOf(part, draft) ? "applied" : keyOf(part, current) === keyOf(part, savedParts(base)) ? "not_applied" : "changed");
  if (outcomes.length === 0 || outcomes.every((outcome) => outcome === "not_applied")) return "not_applied";
  return outcomes.every((outcome) => outcome === "applied") ? "applied" : "changed";
}
