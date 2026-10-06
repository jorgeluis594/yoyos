import { z } from "zod";
import { ok, err } from "@shared/functional";
import type { Result } from "@shared/result";
import { compare, currencies, type Money } from "@shared/money";
import { internationalPhonePattern } from "@shared/phone";
import type { CompanyId, ContactId, OrderId, OrderItem } from "@core/src/features/orders/domain/order";

export type OrderNumber = number & { readonly __brand: "OrderNumber" };
export type BuyerName = string & { readonly __brand: "BuyerName" };
export type PhoneNumber = string & { readonly __brand: "PhoneNumber" };
export type BuyerData = Readonly<{ name: BuyerName; phone: PhoneNumber }>;
export type OrderBuyer = Readonly<{ contactId: ContactId | null; name: string | null; phone: string }>;
export type CheckoutAccess = Readonly<{ companyId: CompanyId; orderId: OrderId }>;
export type CheckoutError = Readonly<{
  code: "CHECKOUT_UNAVAILABLE" | "ORDER_CANCELLED" | "INVALID_BUYER" | "TOTAL_CHANGED" | "INVALID_CHECKOUT" | "PERSISTENCE_UNAVAILABLE";
  message: string;
}>;
export type CheckoutOrder = Readonly<{
  id: OrderId;
  companyId: CompanyId;
  companyName: string;
  number: OrderNumber;
  buyer: OrderBuyer | null;
  items: readonly OrderItem[];
  itemsTotal: Money;
  total: Money;
  cancelled: boolean;
  checkoutEnabledAt: Date | null;
  checkoutConfirmedAt: Date | null;
}>;
export type CheckoutState =
  | Readonly<{ kind: "not_enabled" }>
  | Readonly<{ kind: "pending" }>
  | Readonly<{ kind: "confirmed"; confirmedAt: Date }>
  | Readonly<{ kind: "cancelled" }>;
export type CheckoutView = Readonly<{
  companyName: string;
  number: OrderNumber;
  buyer: Readonly<{ name: string | null; phone: string }> | null;
  items: readonly Pick<OrderItem, "productName" | "variantAttributes" | "sku" | "quantity" | "unitPrice" | "subtotal">[];
  itemsTotal: Money;
  total: Money;
  state: Exclude<CheckoutState, { kind: "not_enabled" }>;
}>;

const numberSchema = z.number().int().safe().min(1001);
const buyerSchema = z.strictObject({ name: z.string().trim().min(1), phone: z.string().regex(internationalPhonePattern) });
const amounts = z.strictObject({ amount: z.number().finite().nonnegative().refine((value) => /^\d+(?:\.\d{1,2})?$/.test(String(value))), currency: z.enum(currencies) });
const dates = z.object({ checkoutEnabledAt: z.date().nullable(), checkoutConfirmedAt: z.date().nullable() })
  .refine((value) => value.checkoutConfirmedAt === null || value.checkoutEnabledAt !== null);

export function parseOrderNumber(value: unknown): Result<OrderNumber, CheckoutError> {
  const parsed = numberSchema.safeParse(value);
  return parsed.success ? ok(parsed.data as OrderNumber) : err({ code: "INVALID_CHECKOUT", message: "Invalid order number" });
}

export function parseBuyer(value: unknown): Result<BuyerData, CheckoutError> {
  const parsed = buyerSchema.safeParse(value);
  return parsed.success ? ok({ name: parsed.data.name as BuyerName, phone: parsed.data.phone as PhoneNumber })
    : err({ code: "INVALID_BUYER", message: "Buyer name and international phone are required" });
}

export function checkoutState(order: Pick<CheckoutOrder, "checkoutEnabledAt" | "checkoutConfirmedAt" | "cancelled" | "buyer">): Result<CheckoutState, CheckoutError> {
  if (!dates.safeParse(order).success || (order.checkoutConfirmedAt && (!order.buyer || !parseBuyer({ name: order.buyer.name, phone: order.buyer.phone }).success)))
    return err({ code: "INVALID_CHECKOUT", message: "Invalid stored checkout state" });
  if (order.cancelled) return ok({ kind: "cancelled" });
  if (order.checkoutEnabledAt === null) return ok({ kind: "not_enabled" });
  return ok(order.checkoutConfirmedAt ? { kind: "confirmed", confirmedAt: order.checkoutConfirmedAt } : { kind: "pending" });
}

export function checkoutView(order: CheckoutOrder): Result<CheckoutView, CheckoutError> {
  const state = checkoutState(order);
  if (!state.success) return state;
  if (!order.checkoutEnabledAt || state.data.kind === "not_enabled") return err({ code: "CHECKOUT_UNAVAILABLE", message: "Checkout is unavailable" });
  return ok({ companyName: order.companyName, number: order.number,
    buyer: order.buyer ? { name: order.buyer.name, phone: order.buyer.phone } : null,
    items: order.items.map(({ productName, variantAttributes, sku, quantity, unitPrice, subtotal }) => ({ productName, variantAttributes, sku, quantity, unitPrice, subtotal })),
    itemsTotal: order.itemsTotal, total: order.total, state: state.data });
}

export function checkExpectedTotal(expected: Money, current: Money): Result<null, CheckoutError> {
  if (!amounts.safeParse(expected).success || !amounts.safeParse(current).success)
    return err({ code: "INVALID_CHECKOUT", message: "Invalid checkout amount" });
  const compared = compare(expected)(current);
  return compared.success && compared.data === 0 ? ok(null) : err({ code: "TOTAL_CHANGED", message: "Review the current total before confirming" });
}
