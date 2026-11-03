import type { OrderAggregateResponse } from "@shared/contracts/orders";
import type { OrderReviewResponse } from "@shared/contracts/order-review";
import { typedQuantity } from "@mobile/features/orders/presentation/order-items-editor";

type Item = OrderAggregateResponse["items"][number];

/** The seller's corrections of marked items, by item id: the typed quantity, or removed. An item without an entry is as loaded. */
export type CorrectionDraft = Readonly<Record<string, Readonly<{ quantity: string; removed: boolean }>>>;
export type Correction = Readonly<{ itemId: string; quantity: number }>;

export const quantityTextOf = (draft: CorrectionDraft, item: Item) => draft[item.id]?.quantity ?? String(item.quantity);
export const isRemoved = (draft: CorrectionDraft, item: Item) => draft[item.id]?.removed === true;
const isChanged = (draft: CorrectionDraft, item: Item) => isRemoved(draft, item) || quantityTextOf(draft, item) !== String(item.quantity);

export const changedItems = (draft: CorrectionDraft, items: readonly Item[]) => items.filter((item) => isChanged(draft, item));
export const hasCorrections = (draft: CorrectionDraft, items: readonly Item[]) => changedItems(draft, items).length > 0;
export const remainingCount = (draft: CorrectionDraft, items: readonly Item[]) => items.filter((item) => !isRemoved(draft, item)).length;

/** The corrections to send (0 removes the item), or null while a typed quantity is not a whole number from 1 to 9999. */
export function correctionsToSend(draft: CorrectionDraft, items: readonly Item[]): Correction[] | null {
  const corrections: Correction[] = [];
  for (const item of changedItems(draft, items)) {
    if (isRemoved(draft, item)) { corrections.push({ itemId: item.id, quantity: 0 }); continue; }
    const quantity = typedQuantity(quantityTextOf(draft, item));
    if (quantity === null) return null;
    corrections.push({ itemId: item.id, quantity });
  }
  return corrections;
}

/**
 * After a reload, keeps the corrections that still apply: on items that are still marked, whose line did not change meanwhile and that no message touched.
 */
export function keepCorrections(draft: CorrectionDraft, before: OrderAggregateResponse, after: OrderAggregateResponse, review: OrderReviewResponse, touched: ReadonlySet<string>): CorrectionDraft {
  const marked = new Set(review.doubtful.flatMap((doubt) => doubt.change.after ? [doubt.change.after.itemId] : []));
  const kept = Object.entries(draft).filter(([itemId]) => {
    const was = before.items.find((item) => item.id === itemId);
    const now = after.items.find((item) => item.id === itemId);
    return was && now && marked.has(itemId) && !touched.has(itemId) && was.quantity === now.quantity;
  });
  return Object.fromEntries(kept);
}
