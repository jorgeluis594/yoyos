import type { ProductForReading } from "@core/src/features/products/domain/reading-product";

/** Why a product the reader knows cannot be added; null (deleted) reads as not sold. */
export function notAvailableReason(product: Pick<ProductForReading, "hidden"> | null): "hidden" | "not_sold" {
  return product?.hidden ? "hidden" : "not_sold";
}

/** The quantity changes a hidden product limits; ResolvedChatAction's increase_quantity and set_quantity satisfy it without importing chat-order, which would close a cycle. */
export type QuantityChange = Readonly<{ kind: "increase_quantity" }> | Readonly<{ kind: "set_quantity"; quantity: number }>;

/** Whether a message's quantity change on an item of this product is refused: a hidden product's item can be lowered, removed or set at or below its quantity, never raised. */
export function refusesRaise(
  product: Pick<ProductForReading, "hidden"> | null,
  item: Readonly<{ quantity: number }>,
  change: QuantityChange,
): boolean {
  if (!product?.hidden) return false;
  return change.kind === "increase_quantity" || change.quantity > item.quantity;
}
