import type { ReadingInput, ReadingPending } from "@core/src/features/orders/domain/reader/readings";

type Flat = (text: string) => string;

/**
 * A pending as the intent and extraction stages read it: its product (or the choice it is between), what is known and, for a pending on
 * one product, each attribute still missing with the sellable values that fit. Catalog data only, so the model can see what a bare detail completes.
 */
export function pendingLine(pending: ReadingPending, flat: Flat = (text) => text): string {
  const names = pending.productNames?.map(flat);
  const subject = names ? names.join(" / ") : pending.productIds.length > 1 ? `a choice between ${pending.productIds.length} products` : "one product";
  const choice = names && names.length > 1 ? "a choice between: " : "";
  const known = Object.entries(pending.known).map(([name, value]) => `${flat(name)} ${flat(value)}`).join(" · ");
  const missing = (pending.missing ?? []).map(({ name, values }) => `${flat(name)} (${values.map(flat).join(", ")})`).join(" · ");
  return `${pending.ref}: ${choice}${subject}${known ? ` · known: ${known}` : ""}${missing ? ` · missing: ${missing}` : ""} · quantity ${pending.quantity}${pending.doubtful ? " · in doubt" : ""}`;
}

/** What the buyer's previous photo left, pointing at the pending or order line it left by ref (the lines name the product). */
export function photoLeftText({ photoMemory, pendings, items }: ReadingInput): string {
  const left = photoMemory?.left ?? null;
  if (left === null) return "";
  if (left.kind === "pending") {
    const pending = pendings.find(({ pendingId }) => pendingId === left.pendingId);
    return pending ? `a pending (${pending.ref})` : "a pending";
  }
  const item = items.find(({ variantId }) => variantId === left.variantId);
  return item ? `an item in the order (${item.ref})` : "an item in the order";
}
