import { dispatchLabelMaxOrders } from "@shared/contracts/dispatch-labels";

/** What the bulk bar needs about a selected order, kept even when its page is no longer shown. */
export type SelectedOrder = Readonly<{
  id: string;
  number: number;
  deliveryMethod: "home" | "agency" | "pickup" | "none";
  status: "active" | "cancelled" | "completed";
}>;

export type OrderLabelSelection = Readonly<Record<string, SelectedOrder>>;
export type SkipReason = "none" | "pickup" | "cancelled";
export type PageSelectionState = "all" | "some" | "empty";

export const emptySelection: OrderLabelSelection = {};

export const selectedOrder = ({ id, number, deliveryMethod, status }: SelectedOrder): SelectedOrder => ({ id, number, deliveryMethod, status });

/** The server decides the final result; the list only predicts what it already knows. A cancelled order wins, as on the server. */
export function skipReason(order: SelectedOrder): SkipReason | null {
  if (order.status === "cancelled") return "cancelled";
  if (order.deliveryMethod === "none") return "none";
  if (order.deliveryMethod === "pickup") return "pickup";
  return null;
}

export function toggleOrder(selection: OrderLabelSelection, order: SelectedOrder): OrderLabelSelection {
  if (selection[order.id]) {
    return Object.fromEntries(Object.entries(selection).filter(([id]) => id !== order.id));
  }
  return { ...selection, [order.id]: selectedOrder(order) };
}

export function pageSelectionState(selection: OrderLabelSelection, page: readonly SelectedOrder[]): PageSelectionState {
  const count = page.filter((order) => selection[order.id]).length;
  return count === 0 ? "empty" : count === page.length ? "all" : "some";
}

/** Selects the whole page, or unselects it when it was already complete. */
export function togglePage(selection: OrderLabelSelection, page: readonly SelectedOrder[]): OrderLabelSelection {
  if (pageSelectionState(selection, page) === "all") {
    const pageIds = new Set(page.map((order) => order.id));
    return Object.fromEntries(Object.entries(selection).filter(([id]) => !pageIds.has(id)));
  }
  return { ...selection, ...Object.fromEntries(page.map((order) => [order.id, selectedOrder(order)])) };
}

export type SelectionSummary = Readonly<{
  total: number;
  skipped: Readonly<Record<SkipReason, number>>;
  skippedTotal: number;
  printableIds: readonly string[];
  overLimit: boolean;
}>;

export function summarizeSelection(selection: OrderLabelSelection): SelectionSummary {
  const orders = Object.values(selection);
  const skipped = { none: 0, pickup: 0, cancelled: 0 };
  const printableIds: string[] = [];
  for (const order of orders) {
    const reason = skipReason(order);
    if (reason) skipped[reason] += 1; else printableIds.push(order.id);
  }
  return { total: orders.length, skipped, skippedTotal: orders.length - printableIds.length, printableIds, overLimit: orders.length > dispatchLabelMaxOrders };
}

type ListFilters = Readonly<{ customer: string; search?: string | undefined; view?: string | undefined; createdFrom?: string | undefined; createdBefore?: string | undefined }>;

/** Everything that defines which orders the list shows except the page; changing it clears the selection. */
export const selectionScope = (base: string, filters: ListFilters): string =>
  JSON.stringify([base, filters.customer, filters.search ?? null, filters.view ?? "all", filters.createdFrom ?? null, filters.createdBefore ?? null]);
