import type { ProductId } from "@core/src/features/products/domain/product";
import type { RequestRef } from "@core/src/features/orders/domain/reader/refs";
import type { ExtractedRequest, ReadingInput } from "@core/src/features/orders/domain/reader/readings";

export type MentionSearch = Readonly<{ request: RequestRef; productIds: readonly ProductId[]; unavailableProductIds: readonly ProductId[] }>;
export type AssembledCandidates = Readonly<{
  /** Every distinct product the resolution may see, in search rank order, then the photo's, the items' and the pendings'. */
  productIds: readonly ProductId[];
  /** Per mention: its searched products (sellable first, one slot kept for an unavailable twin when `perMention` is 2 or more), then the photo's, items' and pendings'. */
  byMention: ReadonlyMap<RequestRef, readonly ProductId[]>;
}>;

/**
 * A pure merge of the searched, photo, item and pending products, at most `perMention` per mention. An unavailable twin keeps one slot
 * so a named product that is not sellable is still offered. Products the chat already holds fill the slots the search left.
 */
export function assembleCandidates(input: Readonly<{ searched: readonly MentionSearch[]; photoProductId: ProductId | null;
  itemProductIds: readonly ProductId[]; pendingProductIds: readonly ProductId[]; perMention: number }>): AssembledCandidates {
  const known = [...new Set([...input.photoProductId ? [input.photoProductId] : [], ...input.itemProductIds, ...input.pendingProductIds])];
  const byMention = new Map<RequestRef, readonly ProductId[]>();
  for (const { request, productIds, unavailableProductIds } of input.searched) {
    const twins = unavailableProductIds.slice(0, input.perMention >= 2 ? 1 : 0);
    const sellable = productIds.slice(0, input.perMention - twins.length);
    byMention.set(request, [...new Set([...sellable, ...twins, ...known])].slice(0, input.perMention));
  }
  const productIds = [...new Set([...input.searched.flatMap(({ request }) => byMention.get(request) ?? []), ...known])];
  return { productIds, byMention };
}

/**
 * The products a request that names none points to, from its target: the pending's, the order item's, the shown photo's or what the photo just
 * sent left. Empty when the target does not fix a product (the checks then compare the buyer's words with the catalog letter by letter).
 */
export function productsOfTarget(request: ExtractedRequest, input: ReadingInput, photoProductIds: readonly ProductId[]): readonly ProductId[] {
  const { target } = request;
  const itemProduct = (ref: string) => input.items.find((item) => item.ref === ref)?.productId ?? null;
  const ids = ((): readonly (ProductId | null)[] => {
    switch (target.kind) {
      case "pending": return input.pendings.find(({ ref }) => ref === target.ref)?.productIds ?? [];
      case "item": return [itemProduct(target.ref)];
      case "photo_same_message": return photoProductIds;
      case "context": return target.basis === "only_item" ? [itemProduct(target.ref)] : target.basis === "last_photo" ? photoProductIds : [];
      case "photo_just_sent": {
        const left = input.photoMemory?.left;
        if (left?.kind === "pending") return input.pendings.find(({ pendingId }) => pendingId === left.pendingId)?.productIds ?? [];
        return left?.kind === "item" ? [input.items.find(({ variantId }) => variantId === left.variantId)?.productId ?? null] : [];
      }
      case "named": case "none": return [];
    }
  })();
  return [...new Set(ids.flatMap((id) => (id ? [id] : [])))];
}
