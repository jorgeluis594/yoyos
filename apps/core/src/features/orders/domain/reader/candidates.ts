import type { ProductId } from "@core/src/features/products/domain/product";
import type { RequestRef } from "@core/src/features/orders/domain/reader/refs";

export type MentionSearch = Readonly<{ request: RequestRef; productIds: readonly ProductId[]; unavailableProductIds: readonly ProductId[] }>;
export type AssembledCandidates = Readonly<{
  /** Every distinct product the resolution may see, in search rank order, then the photo's, the items' and the pendings'. */
  productIds: readonly ProductId[];
  /** Per mention: its searched products (sellable first, one slot kept for an unavailable twin), then the photo's, items' and pendings'. */
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
    const twins = unavailableProductIds.slice(0, Math.min(1, input.perMention));
    const sellable = productIds.slice(0, input.perMention - twins.length);
    byMention.set(request, [...new Set([...sellable, ...twins, ...known])].slice(0, input.perMention));
  }
  const productIds = [...new Set([...input.searched.flatMap(({ request }) => byMention.get(request) ?? []), ...known])];
  return { productIds, byMention };
}
