import { orderSelectionSchema, type OrderSelectionRequest, type OrderAggregateResponse } from "@shared/contracts/orders";
import { add, multiply, type Money } from "@shared/money";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";

export type OrderDraftItem = Readonly<{
  variantId: OrderSelectionRequest["items"][number]["variantId"];
  productName: string;
  variantAttributes: Readonly<Record<string, string>>;
  sku: string | null;
  shownUnitPrice: Money;
  shownStock: number;
  quantity: number;
}>;

export type OrderDraft =
  | Readonly<{ kind: "empty"; customer: OrderAggregateResponse["customer"]; items: readonly [] }>
  | Readonly<{ kind: "items"; id: OrderSelectionRequest["id"]; customer: OrderAggregateResponse["customer"];
      items: readonly [OrderDraftItem, ...OrderDraftItem[]] }>;

export type CartError = Readonly<{ code: "INVALID_CART"; message: string }>;
const invalid = () => err<CartError>({ code: "INVALID_CART", message: "Invalid order selection" });

export const emptyOrderDraft = (): OrderDraft => ({ kind: "empty", customer: { kind: "general_public" }, items: [] });

export function prepareOrder(draft: OrderDraft): Result<{ request: OrderSelectionRequest; shownTotal: Money }, CartError> {
  if (draft.kind === "empty" || new Set(draft.items.map((item) => item.variantId)).size !== draft.items.length) return invalid();
  let total: Money | null = null;
  for (const item of draft.items) {
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || !Number.isSafeInteger(item.shownStock) ||
      item.quantity > item.shownStock || item.shownUnitPrice.amount <= 0) return invalid();
    const subtotal = multiply(item.shownUnitPrice)(item.quantity);
    if (!subtotal.success) return invalid();
    if (total) {
      const sum = add(subtotal.data)(total);
      if (!sum.success) return invalid();
      total = sum.data;
    } else total = subtotal.data;
  }
  const parsed = orderSelectionSchema.safeParse({ id: draft.id,
    contactId: draft.customer.kind === "contact" ? draft.customer.contactId : null,
    items: draft.items.map(({ variantId, quantity }) => ({ variantId, quantity })) });
  return parsed.success && total ? ok({ request: parsed.data, shownTotal: total }) : invalid();
}

export function addDraftItem(draft: OrderDraft, item: OrderDraftItem, newId: () => string): Result<OrderDraft, CartError> {
  if (draft.items.some((current) => current.variantId === item.variantId)) return invalid();
  const next: OrderDraft = draft.kind === "empty"
    ? { kind: "items", id: newId(), customer: draft.customer, items: [item] }
    : { ...draft, items: [...draft.items, item] };
  return prepareOrder(next).success ? ok(next) : invalid();
}

export function changeDraftQuantity(draft: OrderDraft, variantId: string, quantity: number): Result<OrderDraft, CartError> {
  if (draft.kind === "empty" || !draft.items.some((item) => item.variantId === variantId)) return invalid();
  const items = draft.items.map((item) => item.variantId === variantId ? { ...item, quantity } : item);
  const [first, ...rest] = items;
  const next: OrderDraft = { ...draft, items: [first, ...rest] };
  return prepareOrder(next).success ? ok(next) : invalid();
}

export function removeDraftItem(draft: OrderDraft, variantId: string): OrderDraft {
  if (draft.kind === "empty") return draft;
  const items = draft.items.filter((item) => item.variantId !== variantId);
  const [first, ...rest] = items;
  return first ? { ...draft, items: [first, ...rest] } : { kind: "empty", customer: draft.customer, items: [] };
}

export function setDraftCustomer(draft: OrderDraft, customer: OrderDraft["customer"]): OrderDraft {
  return { ...draft, customer };
}
