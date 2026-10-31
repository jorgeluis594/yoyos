import { err, ok } from "@shared/functional";
import type { Money } from "@shared/money";
import { maxOrderLineQuantity, maxOrderLines } from "@shared/orders-edit";
import type { Result } from "@shared/result";
import type { BuyerData } from "@core/src/features/orders/domain/checkout";
import type { BuildOrderError, OrderItem, OrderItemId, PositiveInteger } from "@core/src/features/orders/domain/order";
import type { SellableVariant } from "@core/src/features/orders/domain/catalog-order";
import { orderStateMachine, parseDeliverySnapshot, type AgencyRecipient, type DeliveryAuthor, type OrderAggregate, type OrderDomainError, type RatedDeliverySelection, type Recipient } from "@core/src/features/orders/domain/order-state-machine";
import type { VariantId } from "@core/src/features/products/domain/product";

/** The parts of an order that the conflict and lock rules are scoped to. */
export type OrderPart = "items" | "customer" | "delivery";

/** Row changes of an order's items: items are compared by id, and a replaced variant is a removed item plus an added one. */
export type OrderItemChanges = Readonly<{ added: readonly OrderItem[]; updated: readonly OrderItem[]; removedItemIds: readonly OrderItemId[] }>;

/** A seller edit line quantity: `PositiveInteger` has no upper bound and this one has. */
export type OrderLineQuantity = number & { readonly __brand: "OrderLineQuantity" };
export type OrderLineRequest = Readonly<{ variantId: VariantId; quantity: OrderLineQuantity }>;

export function parseOrderLineQuantity(value: unknown): Result<OrderLineQuantity, OrderDomainError> {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= maxOrderLineQuantity ? ok(value as OrderLineQuantity)
    : err({ code: "INVALID_ORDER", message: `Quantity must be a whole number from 1 to ${maxOrderLineQuantity}` });
}

/** Only the fields that can change without a new quote, one variant per method, so the agency document rule is part of the type. */
export type DeliveryAmendment =
  | Readonly<{ method: "home"; recipient: Recipient; address: string; instructions: string | null }>
  | Readonly<{ method: "agency"; recipient: AgencyRecipient }>
  | Readonly<{ method: "store"; recipient: Recipient }>;
/** `replace` always quotes again; `amend` keeps the stored pricing. */
export type DeliveryEdit =
  | Readonly<{ kind: "replace"; selection: RatedDeliverySelection; expectedPrice: Money }>
  | Readonly<{ kind: "amend"; amendment: DeliveryAmendment }>;

/** The final state per part that a seller asks for. A part that is absent is not touched. */
export type OrderEditParts = Readonly<{
  items?: Readonly<{ lines: readonly OrderLineRequest[] }>;
  customer?: Readonly<{ value: BuyerData | null }>;
  delivery?: Readonly<{ change: DeliveryEdit }>;
}>;
export type ItemsPlan = Readonly<{ lookup: readonly VariantId[] }>;
export type VariantNotFound = Readonly<{ code: "VARIANT_NOT_FOUND"; message: string; variantId: VariantId }>;
export type CustomerRequired = Readonly<{ code: "CUSTOMER_REQUIRED"; message: string }>;

const failure = (code: OrderDomainError["code"], message: string) => err({ code, message });

/** The stored `variantId → quantity` map must equal the requested one, so a request that repeats a variant is never applied. */
function isItemsApplied(order: OrderAggregate, lines: readonly OrderLineRequest[]): boolean {
  const requested = new Map(lines.map((line) => [line.variantId, line.quantity as number]));
  return requested.size === lines.length && requested.size === order.items.length && order.items.every((item) => requested.get(item.variantId) === item.quantity);
}

/** Structural comparison, so this module stays free of Node imports and usable from client code. */
function sameRecipient(a: Recipient, b: Recipient): boolean {
  return a.name === b.name && a.phone === b.phone && a.identity.kind === b.identity.kind &&
    (a.identity.kind === "absent" || (b.identity.kind === "document" && a.identity.documentType === b.identity.documentType && a.identity.document === b.identity.document));
}

const isCustomerApplied = (order: OrderAggregate, value: BuyerData | null) =>
  (order.buyer?.name ?? null) === (value?.name ?? null) && (order.buyer?.phone ?? null) === (value?.phone ?? null);

function isDeliveryApplied(order: OrderAggregate, change: DeliveryEdit): boolean {
  const stored = order.delivery;
  if (!stored) return false;
  if (change.kind === "amend") {
    const amendment = change.amendment;
    if (stored.method !== amendment.method || !sameRecipient(stored.recipient, amendment.recipient)) return false;
    return amendment.method !== "home" || (stored.method === "home" && stored.destination.address === amendment.address && stored.destination.instructions === amendment.instructions);
  }
  const { selection, expectedPrice } = change;
  if (stored.method !== selection.method || stored.recordedBy.kind !== "seller" || !sameRecipient(stored.recipient, selection.recipient) ||
    order.deliveryCharge.amount !== expectedPrice.amount || order.deliveryCharge.currency !== expectedPrice.currency) return false;
  if (selection.method === "store") return true;
  if (stored.method === "home" && selection.method === "home")
    return stored.pricing.rateId === selection.rateId && stored.destination.districtCode === selection.destination.districtCode &&
      stored.destination.address === selection.destination.address && stored.destination.instructions === (selection.destination.instructions || null);
  return stored.method === "agency" && selection.method === "agency" && stored.pricing.rateId === selection.rateId &&
    stored.destination.districtCode === selection.districtCode && stored.agency.id === selection.agencyId;
}

/** True when the stored state of `part` already equals the requested one, so the part is dropped before any lock or revision check. */
function isApplied(order: OrderAggregate, input: OrderEditParts, part: OrderPart): boolean {
  if (part === "items") return input.items !== undefined && isItemsApplied(order, input.items.lines);
  if (part === "customer") return input.customer !== undefined && isCustomerApplied(order, input.customer.value);
  return input.delivery !== undefined && isDeliveryApplied(order, input.delivery.change);
}

/** A cancelled order refuses every edit and a delivery that left pending refuses items and delivery. Deducted stock does not lock items: the stock listener settles the difference. */
function checkLocks(order: OrderAggregate, parts: ReadonlySet<OrderPart>): Result<null, OrderDomainError> {
  if (parts.size === 0) return ok(null);
  if (order.cancelled) return failure("ORDER_CANCELLED", "Order is cancelled");
  const touchesFulfillment = parts.has("items") || parts.has("delivery");
  if (touchesFulfillment && order.deliveryStatus !== "pending") return failure("DELIVERY_LOCKED", "Delivery has progressed");
  return ok(null);
}

/** The customer of an order the buyer confirmed can be changed but not cleared: the buyer's own name and phone are part of what they confirmed. */
function checkCustomerRequired(order: OrderAggregate, input: OrderEditParts): Result<null, CustomerRequired> {
  if (input.customer?.value === null && order.checkoutConfirmedAt !== null)
    return err({ code: "CUSTOMER_REQUIRED", message: "The customer of an order confirmed by the buyer cannot be cleared" });
  return ok(null);
}

function planItems(order: OrderAggregate, lines: readonly OrderLineRequest[]): Result<ItemsPlan, OrderDomainError> {
  if (lines.length === 0) return failure("INVALID_ORDER", "An order needs at least one item");
  if (lines.length > maxOrderLines) return failure("INVALID_ORDER", `An order has at most ${maxOrderLines} lines`);
  const seen = new Set<string>();
  for (const line of lines) {
    if (!parseOrderLineQuantity(line.quantity).success) return failure("INVALID_ORDER", `Quantity must be a whole number from 1 to ${maxOrderLineQuantity}`);
    if (seen.has(line.variantId)) return failure("INVALID_ORDER", "A variant appears only once in the order");
    seen.add(line.variantId);
  }
  const stored = new Map(order.items.map((item) => [item.variantId, item.quantity as number]));
  const lookup = lines.filter((line) => line.quantity > (stored.get(line.variantId) ?? 0)).map((line) => line.variantId);
  return ok({ lookup });
}

/**
 * Applies the final lines. A kept line keeps its item row (id, copied data, prices, mentioned price) and takes the new quantity;
 * a new line takes the current catalog price. Only new and raised lines need their variant to be sellable.
 */
function applyItems(order: OrderAggregate, lines: readonly OrderLineRequest[], variants: readonly SellableVariant[],
  newItemId: () => OrderItemId): Result<Readonly<{ order: OrderAggregate; changes: OrderItemChanges }>, BuildOrderError | VariantNotFound> {
  const sellable = new Map(variants.map((variant) => [variant.variantId, variant]));
  const stored = new Map(order.items.map((item) => [item.variantId, item]));
  const next: OrderItem[] = [];
  for (const line of lines) {
    const kept = stored.get(line.variantId);
    if (kept && line.quantity <= kept.quantity) {
      next.push({ ...kept, quantity: line.quantity as number as PositiveInteger });
      continue;
    }
    const variant = sellable.get(line.variantId);
    if (!variant) return err({ code: "VARIANT_NOT_FOUND", message: "The variant is no longer available", variantId: line.variantId });
    next.push(kept ? { ...kept, quantity: line.quantity as number as PositiveInteger }
      : { id: newItemId(), variantId: variant.variantId, productName: variant.productName, variantAttributes: variant.variantAttributes, sku: variant.sku,
        quantity: line.quantity as number as PositiveInteger, unitPrice: variant.unitPrice, subtotal: variant.unitPrice, mentionedPrice: null, stockDeductedQuantity: 0 });
  }
  // `appendItems` with no variants rebuilds the items and totals of the order it receives, keeping the delivery charge.
  const rebuilt = orderStateMachine.appendItems({ ...order, items: next as unknown as OrderAggregate["items"] }, [], newItemId);
  if (!rebuilt.success) return rebuilt;
  const requested = new Set(lines.map((line) => line.variantId));
  const previous = new Map(order.items.map((item) => [item.id, item]));
  return ok({ order: rebuilt.data, changes: {
    added: rebuilt.data.items.filter((item) => !previous.has(item.id)),
    updated: rebuilt.data.items.filter((item) => previous.has(item.id) && previous.get(item.id)?.quantity !== item.quantity),
    removedItemIds: order.items.filter((item) => !requested.has(item.variantId)).map((item) => item.id),
  } });
}

/** Empty customer: a contact keeps its link with empty details, anything else loses its buyer row. */
function applyCustomer(order: OrderAggregate, value: BuyerData | null): OrderAggregate {
  const contactId = order.buyer?.contactId ?? null;
  if (value) return { ...order, buyer: { contactId, name: value.name, phone: value.phone } };
  return { ...order, buyer: contactId ? { contactId, name: null, phone: null } : null };
}

/** Changes the recipient (and the address and reference of a home delivery) without a new quote: pricing, cost, charge and total stay. */
function amendDelivery(order: OrderAggregate, amendment: DeliveryAmendment, author: DeliveryAuthor): Result<OrderAggregate, OrderDomainError> {
  const stored = order.delivery;
  if (!stored || stored.method !== amendment.method) return failure("INVALID_ORDER", "The delivery method cannot change without a new quote");
  const changed = stored.method === "home" && amendment.method === "home"
    ? { ...stored, recipient: amendment.recipient, destination: { ...stored.destination, address: amendment.address, instructions: amendment.instructions }, recordedBy: author }
    : { ...stored, recipient: amendment.recipient, recordedBy: author };
  const parsed = parseDeliverySnapshot(changed);
  return parsed.success ? ok({ ...order, delivery: parsed.data }) : parsed;
}

export const orderEdit = { isApplied, checkLocks, checkCustomerRequired, planItems, applyItems, applyCustomer, amendDelivery } as const;
