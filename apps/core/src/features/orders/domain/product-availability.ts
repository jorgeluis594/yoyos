import type { ProductForReading } from "@core/src/features/products/domain/reading-product";
import type { ResolvedChatAction } from "@core/src/features/orders/domain/chat-order";

/** Why a product the reader knows cannot be added; null (deleted) reads as not sold. */
export function notAvailableReason(product: Pick<ProductForReading, "hidden"> | null): "hidden" | "not_sold" {
  return product?.hidden ? "hidden" : "not_sold";
}

/** Whether a message's quantity change on an item of this product is refused: a hidden product's item can be lowered, removed or set at or below its quantity, never raised. */
export function refusesRaise(
  product: Pick<ProductForReading, "hidden"> | null,
  item: Readonly<{ quantity: number }>,
  change: Pick<Extract<ResolvedChatAction, { kind: "increase_quantity" }>, "kind"> | Pick<Extract<ResolvedChatAction, { kind: "set_quantity" }>, "kind" | "quantity">,
): boolean {
  if (!product?.hidden) return false;
  return change.kind === "increase_quantity" || change.quantity > item.quantity;
}
