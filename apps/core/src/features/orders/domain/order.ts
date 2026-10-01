import { add, isCurrency, multiply, type Money } from "@shared/money";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { VariantId } from "@core/src/features/products/domain/product";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";

export type OrderId = string & { readonly __brand: "OrderId" };
export type OrderItemId = string & { readonly __brand: "OrderItemId" };
export type PaymentId = string & { readonly __brand: "PaymentId" };
export type ContactId = string & { readonly __brand: "ContactId" };
export type CompanyId = string & { readonly __brand: "CompanyId" };
export type UserId = string & { readonly __brand: "UserId" };
export type PositiveInteger = number & { readonly __brand: "PositiveInteger" };

export type OrderCustomer = Readonly<{ kind: "general_public" }> | Readonly<{ kind: "contact"; contactId: ContactId; name: string | null; phone: string }>;
export type OrderItem = Readonly<{ id: OrderItemId; variantId: VariantId; productName: string; variantAttributes: Readonly<Record<string, string>>; sku: string | null; quantity: PositiveInteger; unitPrice: Money; subtotal: Money }>;
export type Order = OrderAggregate;
export type PricedOrder = Pick<Order, "id" | "companyId" | "sellerId" | "customer" | "createdAt" | "items" | "total">;
export type BuildOrderError = Readonly<{ code: "INVALID_ORDER" | "CURRENCY_MISMATCH"; message: string; item?: number }>;
export type BuildOrderItem = Readonly<Omit<OrderItem, "quantity" | "subtotal"> & { quantity: number }>;
export type BuildOrderInput = Readonly<Omit<PricedOrder, "items" | "total"> & { items: readonly BuildOrderItem[] }>;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const maxTotalCents = 999999999999999;
const maxUnitCents = 99999999999;
const validAmount = (amount: number, maxCents: number) => {
  if (!Number.isFinite(amount) || amount <= 0 || !/^\d+(?:\.\d{1,2})?$/.test(amount.toString())) return false;
  const [whole, fraction = ""] = amount.toString().split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0")) <= BigInt(maxCents);
};

export function buildOrder(input: BuildOrderInput): Result<PricedOrder, BuildOrderError> {
  if (!uuid.test(input.id) || !uuid.test(input.companyId) || !input.sellerId || !(input.createdAt instanceof Date) || !Number.isFinite(input.createdAt.getTime()) || !input.items.length ||
    !["contact", "general_public"].includes(input.customer.kind) ||
    (input.customer.kind === "contact" && (!uuid.test(input.customer.contactId) || !input.customer.phone || (input.customer.name !== null && typeof input.customer.name !== "string")))) {
    return err({ code: "INVALID_ORDER", message: "Invalid order header" });
  }
  const seen = new Set<string>();
  const itemIds = new Set<string>();
  const items: OrderItem[] = [];
  let total: Money | undefined;
  for (const [index, item] of input.items.entries()) {
    if (!uuid.test(item.id) || itemIds.has(item.id) || !uuid.test(item.variantId) || seen.has(item.variantId) || !item.productName.trim() ||
      !Number.isSafeInteger(item.quantity) || item.quantity <= 0 || !isCurrency(item.unitPrice.currency) ||
      !validAmount(item.unitPrice.amount, maxUnitCents) || (item.sku !== null && typeof item.sku !== "string") ||
      !item.variantAttributes || Array.isArray(item.variantAttributes) || typeof item.variantAttributes !== "object" ||
      Object.values(item.variantAttributes).some((value) => typeof value !== "string")) {
      return err({ code: "INVALID_ORDER", message: "Invalid order item", item: index });
    }
    seen.add(item.variantId);
    itemIds.add(item.id);
    if (total && total.currency !== item.unitPrice.currency) return err({ code: "CURRENCY_MISMATCH", message: "Order items must use one currency", item: index });
    const subtotal = multiply(item.unitPrice)(item.quantity);
    if (!subtotal.success || !validAmount(subtotal.data.amount, maxTotalCents)) return err({ code: "INVALID_ORDER", message: "Subtotal exceeds supported range", item: index });
    const nextTotal = total ? add(subtotal.data)(total) : ok(subtotal.data);
    if (!nextTotal.success || !validAmount(nextTotal.data.amount, maxTotalCents)) return err({ code: "INVALID_ORDER", message: "Total exceeds supported range", item: index });
    total = nextTotal.data;
    items.push({ ...item, quantity: item.quantity as PositiveInteger, variantAttributes: { ...item.variantAttributes }, unitPrice: { ...item.unitPrice }, subtotal: subtotal.data });
  }
  return ok({ id: input.id, companyId: input.companyId, sellerId: input.sellerId,
    customer: input.customer.kind === "contact" ? { ...input.customer } : { kind: "general_public" },
    createdAt: new Date(input.createdAt), items: items as [OrderItem, ...OrderItem[]], total: total! });
}
