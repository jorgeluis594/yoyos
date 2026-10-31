import { createHash } from "node:crypto";
import { err, ok } from "@shared/functional";
import type { Money } from "@shared/money";
import type { Result } from "@shared/result";
import type { OrderPart } from "@core/src/features/orders/domain/order-edit";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";

/** Opaque digest of one part of an order as stored. It is a digest, not a counter, because no stored counter exists. */
export type OrderRevision = string & { readonly __brand: "OrderRevision" };
export type OrderRevisions = Readonly<Record<OrderPart, OrderRevision>>;

const revisionPattern = /^[A-Za-z0-9_-]{43}$/;

export function parseOrderRevision(value: unknown): Result<OrderRevision, Readonly<{ code: "INVALID_INPUT"; message: string }>> {
  return typeof value === "string" && revisionPattern.test(value) ? ok(value as OrderRevision) : err({ code: "INVALID_INPUT", message: "Invalid order revision" });
}

/** Money is digested as whole cents and its currency, never as a float string. */
const cents = (money: Money) => [Math.round(money.amount * 100), money.currency];

/** JSON with sorted keys, so the same content always gives the same text. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const digest = (part: OrderPart, value: unknown) => createHash("sha256").update(canonical({ part, value })).digest("base64url") as OrderRevision;

/**
 * One token per editable part. Payments, totals, stock and fulfillment are excluded on purpose, and so is any copied catalog data
 * (name, attributes, SKU), so a catalog edit or a payment never invalidates an edit in progress.
 */
export function orderRevisions(order: OrderAggregate): OrderRevisions {
  const items = [...order.items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((item) => [item.id, item.variantId, item.quantity, ...cents(item.unitPrice), item.mentionedPrice ? { amount: cents(item.mentionedPrice.amount), units: item.mentionedPrice.units } : null]);
  const buyer = order.buyer ? { contactId: order.buyer.contactId, name: order.buyer.name, phone: order.buyer.phone } : null;
  return { items: digest("items", items), customer: digest("customer", buyer), delivery: digest("delivery", order.delivery) };
}
