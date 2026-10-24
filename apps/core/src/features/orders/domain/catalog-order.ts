import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { buildPendingCatalogOrder, type OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { BuildOrderError, BuildOrderItem, CompanyId, OrderId, OrderItemId } from "@core/src/features/orders/domain/order";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { VariantId } from "@core/src/features/products/domain/product";

export type CartQuantity = number & { readonly __brand: "CartQuantity" };
export type CartLine = Readonly<{ variantId: VariantId; quantity: CartQuantity }>;
/** `available` is the stock capped at 99, the cart maximum; the exact quantity is never exposed. */
export type SellableVariant = Omit<BuildOrderItem, "id" | "quantity"> & Readonly<{ available: number }>;
export type LineIssue = Readonly<{ variantId: VariantId } & (
  | { reason: "unavailable" }
  | { reason: "sold_out" }
  | { reason: "insufficient"; available: number }
  | { reason: "other_currency" }
)>;

export const maxCartQuantity = 99;
export const maxCartLines = 30;

export function parseCartQuantity(value: unknown): Result<CartQuantity, Readonly<{ code: "INVALID_QUANTITY"; message: string }>> {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= maxCartQuantity
    ? ok(value as CartQuantity) : err({ code: "INVALID_QUANTITY", message: "Quantity must be a whole number from 1 to 99" });
}

/** A catalog order the buyer has not confirmed yet; sellers treat it as non-existent. */
export function isPendingCatalogOrder(order: Pick<OrderAggregate, "fromCatalog" | "checkoutConfirmedAt">) {
  return order.fromCatalog && order.checkoutConfirmedAt === null;
}

/** Every line that cannot be sold as asked, all at once, so the buyer fixes the cart in one pass. The order takes the currency of the first sellable line. */
export function checkCartAvailability(lines: readonly CartLine[], variants: readonly SellableVariant[]): readonly LineIssue[] {
  const byId = new Map(variants.map((variant) => [variant.variantId, variant]));
  const currency = lines.map((line) => byId.get(line.variantId)?.unitPrice.currency).find(Boolean);
  return lines.flatMap((line): LineIssue[] => {
    const variant = byId.get(line.variantId);
    if (!variant) return [{ variantId: line.variantId, reason: "unavailable" }];
    if (variant.unitPrice.currency !== currency) return [{ variantId: line.variantId, reason: "other_currency" }];
    if (variant.available <= 0) return [{ variantId: line.variantId, reason: "sold_out" }];
    return line.quantity > variant.available ? [{ variantId: line.variantId, reason: "insufficient", available: variant.available }] : [];
  });
}

export type BuildCatalogOrderInput = Readonly<{ id: OrderId; companyId: CompanyId; number: OrderNumber; lines: readonly CartLine[];
  variants: readonly SellableVariant[]; itemIds: readonly OrderItemId[]; now: Date }>;

/** Lines must have passed `checkCartAvailability`; prices come from the variants, never from the cart. */
export function buildCatalogOrder(input: BuildCatalogOrderInput): Result<OrderAggregate, BuildOrderError> {
  const byId = new Map(input.variants.map((variant) => [variant.variantId, variant]));
  const items = input.lines.map((line, index) => {
    const { variantId, productName, variantAttributes, sku, unitPrice } = byId.get(line.variantId)!;
    return { id: input.itemIds[index], variantId, productName, variantAttributes, sku, unitPrice, quantity: line.quantity };
  });
  const built = buildPendingCatalogOrder({ id: input.id, companyId: input.companyId, number: input.number,
    customer: { kind: "general_public" }, createdAt: input.now, items });
  return built;
}
