import type { AppliedChatActions } from "@core/src/features/orders/domain/chat-order";
import type { ChatOrderTarget } from "@core/src/features/orders/domain/chat-order-target";
import type { ChatPending, LastIncomingPhoto, PhotoLeft } from "@core/src/features/orders/domain/chat-pendings";
import type { PositiveInteger } from "@core/src/features/orders/domain/order";
import type { ProductId } from "@core/src/features/products/domain/product";

export type IncomingMessageKind = "text" | "photo";

const nothingLeft: LastIncomingPhoto = { left: null };

/** What the one shown product of a photo left in the chat: its pending, or its item in the order after the message. */
function leftBy(product: ProductId, applied: AppliedChatActions): PhotoLeft | null {
  const added = applied.outcomes.find((outcome) => outcome.kind === "added" && outcome.identification.productId === product);
  if (added?.kind === "added" && applied.target.kind === "open") {
    const item = applied.target.order.items.find(({ variantId }) => variantId === added.variantId);
    return item ? { kind: "item", orderId: applied.target.order.id, variantId: item.variantId, quantity: item.quantity as PositiveInteger } : null;
  }
  const isProductPending = (pending: ChatPending) => pending.subject.kind === "variant" && pending.subject.productId === product;
  for (const outcome of applied.outcomes) {
    const ids = outcome.kind === "pending_created" || outcome.kind === "pending_updated" ? [outcome.pendingId] : outcome.kind === "pending_split" ? [outcome.pendingId, outcome.newPendingId] : [];
    const pending = applied.pendings.pendings.find((candidate) => ids.includes(candidate.id) && isProductPending(candidate));
    if (pending) return { kind: "pending", pendingId: pending.id };
  }
  return null;
}

/**
 * The memory after a message: a photo stores what it left when it counts as the photo just sent; a read text clears it.
 * A photo right after another photo, or without exactly one shown product, leaves nothing.
 */
export function nextLastIncomingPhoto(input: Readonly<{ kind: IncomingMessageKind; previous: LastIncomingPhoto | null; shownProductIds: readonly ProductId[]; applied: AppliedChatActions }>): LastIncomingPhoto | null {
  if (input.kind === "text") return null;
  const [only, ...more] = input.shownProductIds;
  if (input.previous !== null || only === undefined || more.length > 0) return nothingLeft;
  return { left: leftBy(only, input.applied) };
}

/** The line the reader is told about, while it is still what the photo left; null when the message being read is a photo. */
export function photoJustSentOf(kind: IncomingMessageKind, memory: LastIncomingPhoto | null, target: ChatOrderTarget, pendings: readonly ChatPending[]): PhotoLeft | null {
  const left = kind === "text" ? memory?.left ?? null : null;
  if (!left) return null;
  if (left.kind === "pending") return pendings.some(({ id }) => id === left.pendingId) ? left : null;
  if (target.kind !== "open" || target.order.id !== left.orderId) return null;
  return target.order.items.some(({ variantId, quantity }) => variantId === left.variantId && quantity === left.quantity) ? left : null;
}

/** The memory a failed message leaves: as a photo that left nothing. */
export function memoryAfterFailure(): LastIncomingPhoto {
  return nothingLeft;
}
