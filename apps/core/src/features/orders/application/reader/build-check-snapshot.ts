import type { ChatMessageOutcome, StoredChatMessageOutcome } from "@core/src/features/orders/domain/chat-message-outcome";
import type { ChatOrderTarget } from "@core/src/features/orders/domain/chat-order-target";
import type { ChatPending, LastIncomingPhoto } from "@core/src/features/orders/domain/chat-pendings";
import { photoJustSentOf } from "@core/src/features/orders/domain/photo-just-sent";
import type { CheckItem, CheckProduct, CheckSnapshot, LastPhoto } from "@core/src/features/orders/domain/reader/check-requests";
import type { BuyerLanguage, ContextMessageRef, PendingRef, ReadingInput } from "@core/src/features/orders/domain/reader/readings";
import type { ProductId } from "@core/src/features/products/domain/product";
import type { ProductForReading } from "@core/src/features/products/domain/reading-product";
import type { ShownProduct } from "@core/src/features/orders/application/reading-context";

export type SnapshotInput = Readonly<{
  kind: CheckSnapshot["messageKind"];
  language: BuyerLanguage;
  /** The refs the stages answered with: items and pendings keep them whatever the locked state now holds. */
  reading: ReadingInput;
  products: readonly ProductForReading[];
  shown: readonly ShownProduct[];
  /** The chat's order and alive pendings: the locked ones when the checks decide, the unlocked ones for the early look at the confirming chain. */
  target: ChatOrderTarget;
  alive: readonly ChatPending[];
  memory: LastIncomingPhoto | null;
  photo: Readonly<{ ref: ContextMessageRef; outcome: StoredChatMessageOutcome }> | null;
}>;

const identifiedBy = (outcome: ChatMessageOutcome): ProductId | null =>
  outcome.kind === "added" ? outcome.identification.productId : outcome.kind === "not_identified" && outcome.identification ? outcome.identification.productId : null;

/** What the latest incoming photo of the window did: the product it showed and whether it was added, or that it identified nothing. */
function lastPhotoOf(photo: SnapshotInput["photo"]): LastPhoto {
  if (!photo) return { kind: "none" };
  const { outcomes } = photo.outcome;
  const added = outcomes.find((outcome) => outcome.kind === "added");
  if (added?.kind === "added") return { kind: "product", productId: added.identification.productId, added: true };
  const shown = outcomes.map(identifiedBy).find((id) => id !== null);
  if (shown) return { kind: "product", productId: shown, added: false };
  return outcomes.some((outcome) => outcome.kind === "not_identified") ? { kind: "not_identified" } : { kind: "none" };
}

/** The checks' view of the locked state: the lines and pendings the stages saw (by ref) as they are now, the products read, and what the photo memory says. */
export function buildCheckSnapshot(input: SnapshotInput): CheckSnapshot {
  const shownById = new Map(input.shown.map((entry) => [entry.productId, entry]));
  const products = input.products.map((product): CheckProduct => {
    const shown = shownById.get(product.productId);
    return { ...product, shown: shown !== undefined, shownVariantId: shown?.preselectedVariantId ?? null, identification: shown?.identification ?? null };
  });
  const lines = input.target.kind === "open" ? new Map(input.target.order.items.map((item) => [item.id, item])) : new Map();
  const items = input.reading.items.flatMap((listed): CheckItem[] => {
    const line = lines.get(listed.itemId);
    return line ? [{ ref: listed.ref, variantId: line.variantId, productId: listed.productId, productName: line.productName, variantAttributes: line.variantAttributes,
      quantity: line.quantity, unitPrice: line.unitPrice }] : [];
  });
  const refOf = new Map(input.reading.pendings.map(({ pendingId, ref }) => [pendingId as string, ref]));
  // A pending the stages never saw (created since) has no ref the model could have used; it still counts for the checks.
  let extra = input.reading.pendings.length + (input.reading.endedPendings?.length ?? 0);
  const pendings = input.alive.map((pending) => ({ ref: (refOf.get(pending.id) ?? `Q${(extra += 1)}`) as PendingRef, pending }));
  const photoProductIds = input.photo?.outcome.outcomes.map(identifiedBy).filter((id): id is ProductId => id !== null) ?? [];
  const contextProducts = new Map<ContextMessageRef, readonly ProductId[]>(input.photo && photoProductIds.length ? [[input.photo.ref, photoProductIds]] : []);
  const endedPendings = (input.reading.endedPendings ?? []).map(({ ref }) => ref);
  return { messageKind: input.kind, language: input.language, products, items, pendings, ...(endedPendings.length ? { endedPendings } : {}),
    order: input.target.kind === "open" ? "open" : input.target.kind === "closed" ? "closed" : "none",
    photoJustSent: photoJustSentOf(input.kind === "text" ? "text" : "photo", input.memory, input.target, input.alive),
    lastPhoto: lastPhotoOf(input.photo), contextProducts };
}
