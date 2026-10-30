import type { ChatReadingContext, ReadingProduct } from "@core/src/features/orders/domain/chat-reading";
import type { ChatPending, PhotoLeft } from "@core/src/features/orders/domain/chat-pendings";
import type { ChatOrderTarget } from "@core/src/features/orders/domain/chat-order-target";
import type { ProductIdentification } from "@core/src/features/orders/domain/chat-message-outcome";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";
import type { ProductForReading } from "@core/src/features/products/domain/reading-product";

/** A product a photo showed, with the variant its QR label selected (null for a visual match). */
export type ShownProduct = Readonly<{ productId: ProductId; preselectedVariantId: VariantId | null; identification: ProductIdentification }>;

export type ProductSelectionInput = Readonly<{
  shown: readonly ShownProduct[];
  pendings: readonly ChatPending[];
  /** Products of the listed items, in item order. */
  itemProductIds: readonly ProductId[];
  /** Products whose name matches the text, best first. */
  candidateIds: readonly ProductId[];
  /** Products with no active variant that the text names, best first: the lowest priority, so the budget drops them first. */
  unavailableIds?: readonly ProductId[];
  maxProducts: number;
}>;

/**
 * The products the reader gets, in priority order and without repeats, cut at the ceiling:
 * shown products, variant pendings' products, doubtful pendings' candidates round robin, items' products, the text candidates, then the not-sellable candidates.
 */
export function selectReadingProducts(input: ProductSelectionInput): Readonly<{ productIds: readonly ProductId[]; truncated: boolean }> {
  const wanted = new Set<ProductId>();
  for (const { productId } of input.shown) wanted.add(productId);
  for (const { subject } of input.pendings) if (subject.kind === "variant") wanted.add(subject.productId);
  const doubtful = input.pendings.flatMap(({ subject }) => (subject.kind === "product" ? [subject.candidates] : []));
  const rounds = Math.max(0, ...doubtful.map((candidates) => candidates.length));
  for (let round = 0; round < rounds; round += 1) for (const candidates of doubtful) if (candidates[round]) wanted.add(candidates[round]!);
  for (const productId of input.itemProductIds) wanted.add(productId);
  for (const productId of input.candidateIds) wanted.add(productId);
  for (const productId of input.unavailableIds ?? []) wanted.add(productId);
  const all = [...wanted];
  return { productIds: all.slice(0, input.maxProducts), truncated: all.length > input.maxProducts };
}

export type ReadingContextInput = Readonly<{
  kind: ChatReadingContext["kind"];
  text: string | null;
  target: ChatOrderTarget;
  pendings: readonly ChatPending[];
  shown: readonly ShownProduct[];
  /** The ids asked for, in priority order; the refs follow this order. */
  productIds: readonly ProductId[];
  found: readonly ProductForReading[];
  truncated: boolean;
  maxItems: number;
  /** What the photo just sent left, still alive; always null for a photo message. */
  photoJustSent: PhotoLeft | null;
}>;

/** The items listed to the reader: at most `maxItems`, with the product of each. */
export function listedItems(target: ChatOrderTarget, maxItems: number) {
  return target.kind === "open" ? target.order.items.slice(0, maxItems).map((item) => ({ item, productId: target.productIds.get(item.variantId) ?? null })) : [];
}

/** The reader is told about the latest order only as open, closed or none: a cancelled order counts as none. */
const latestOrderOf = (target: ChatOrderTarget): ChatReadingContext["latestOrder"] => (target.kind === "open" ? "open" : target.kind === "closed" ? "closed" : "none");

/** Gives short refs (P1, I1, Q1) to what the reader is shown; they are valid for this reading only. */
export function buildReadingContext(input: ReadingContextInput): ChatReadingContext {
  const byId = new Map(input.found.map((product) => [product.productId, product]));
  const shownById = new Map(input.shown.map((entry) => [entry.productId, entry]));
  const products = input.productIds.flatMap((productId): ReadingProduct[] => {
    const product = byId.get(productId);
    if (!product) return [];
    const shown = shownById.get(productId);
    return [{ ...product, ref: "", shown: shown !== undefined, shownVariantId: shown?.preselectedVariantId ?? null, identification: shown?.identification ?? null }];
  }).map((product, index) => ({ ...product, ref: `P${index + 1}` }));
  const left = input.photoJustSent;
  const items = listedItems(input.target, input.maxItems).map(({ item, productId }, index) => ({ ref: `I${index + 1}`, variantId: item.variantId, productId,
    productName: item.productName, variantAttributes: item.variantAttributes, quantity: item.quantity, unitPrice: item.unitPrice, photoJustSent: left?.kind === "item" && left.variantId === item.variantId }));
  const pendings = input.pendings.map((pending, index) => ({ ref: `Q${index + 1}`, pending, photoJustSent: left?.kind === "pending" && left.pendingId === pending.id }));
  return { kind: input.kind, text: input.text, latestOrder: latestOrderOf(input.target), items, pendings, products, photoJustSent: input.kind === "text" ? left : null, truncated: input.truncated };
}
