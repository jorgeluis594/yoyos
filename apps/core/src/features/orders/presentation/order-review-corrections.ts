import { maxOrderLineQuantity } from "@shared/orders-edit";

/** What the seller changed on a marked item in the review: the typed quantity or Quitar. Items without an entry stay as loaded. */
export type Correction = Readonly<{ kind: "quantity"; text: string }> | Readonly<{ kind: "remove" }>;
export type Corrections = Readonly<Record<string, Correction>>;
export type ReviewedItem = Readonly<{ id: string; quantity: number }>;

/** A whole quantity from 1 to 9999, or null. */
export function parseQuantity(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const quantity = Number(trimmed);
  return quantity >= 1 && quantity <= maxOrderLineQuantity ? quantity : null;
}

const without = (corrections: Corrections, itemId: string): Corrections => Object.fromEntries(Object.entries(corrections).filter(([id]) => id !== itemId));

/** Typing the loaded quantity again is no correction. */
export function typeQuantity(corrections: Corrections, item: ReviewedItem, text: string): Corrections {
  return text === String(item.quantity) ? without(corrections, item.id) : { ...corrections, [item.id]: { kind: "quantity", text } };
}
export const removeItem = (corrections: Corrections, itemId: string): Corrections => ({ ...corrections, [itemId]: { kind: "remove" } });
export const keepItem = without;

export const hasCorrections = (corrections: Corrections) => Object.keys(corrections).length > 0;
export const quantityTextOf = (corrections: Corrections, item: ReviewedItem) => {
  const correction = corrections[item.id];
  return correction?.kind === "quantity" ? correction.text : String(item.quantity);
};
export const isRemoved = (corrections: Corrections, itemId: string) => corrections[itemId]?.kind === "remove";

/** Items that would stay in the order: Quitar cannot take the last one. */
export const itemsLeft = (items: readonly ReviewedItem[], corrections: Corrections) => items.filter((item) => !isRemoved(corrections, item.id)).length;

/** The ids of the items whose typed quantity is not valid. */
export const invalidItems = (corrections: Corrections): readonly string[] =>
  Object.entries(corrections).flatMap(([id, correction]) => correction.kind === "quantity" && parseQuantity(correction.text) === null ? [id] : []);

/** The request's corrections: a quantity of 0 removes the item. Null while a typed quantity is invalid. */
export function toRequest(corrections: Corrections): readonly Readonly<{ itemId: string; quantity: number }>[] | null {
  if (invalidItems(corrections).length > 0) return null;
  return Object.entries(corrections).map(([itemId, correction]) => ({ itemId, quantity: correction.kind === "remove" ? 0 : parseQuantity(correction.text)! }));
}

/**
 * After the review reloads, the corrections stay on the items a message did not touch: the item still exists with the quantity it had,
 * and it is not one of the `affected` items the server named.
 */
export function reconcile(corrections: Corrections, previous: readonly ReviewedItem[], next: readonly ReviewedItem[], affected: readonly string[]): Corrections {
  const kept = Object.entries(corrections).filter(([id]) => {
    const before = previous.find((item) => item.id === id);
    const after = next.find((item) => item.id === id);
    return before !== undefined && after !== undefined && before.quantity === after.quantity && !affected.includes(id);
  });
  return Object.fromEntries(kept);
}
