import { useCallback, useState } from "react";
import type { ListOrderAggregatesResponse } from "@shared/contracts/orders";

export type SelectableOrder = ListOrderAggregatesResponse["items"][number];
type Selection = Readonly<{ key: string; orders: ReadonlyMap<string, SelectableOrder> }>;

/**
 * Selection by order ID across pages. It resets whenever `resetKey` changes (company or filters).
 * D1 consumes `orders`; "select all" only covers the orders passed to `selectPage`.
 */
export function useOrderSelection(resetKey: string) {
  const [selection, setSelection] = useState<Selection>({ key: resetKey, orders: new Map() });
  const current = selection.key === resetKey ? selection.orders : new Map<string, SelectableOrder>();
  const update = useCallback((change: (orders: Map<string, SelectableOrder>) => void) => setSelection((previous) => {
    const orders = new Map(previous.key === resetKey ? previous.orders : []);
    change(orders);
    return { key: resetKey, orders };
  }), [resetKey]);
  const toggle = useCallback((order: SelectableOrder) => update((orders) => { if (!orders.delete(order.id)) orders.set(order.id, order); }), [update]);
  const selectPage = useCallback((page: readonly SelectableOrder[]) => update((orders) => { for (const order of page) orders.set(order.id, order); }), [update]);
  const clear = useCallback(() => update((orders) => orders.clear()), [update]);
  // shortcut: sums amounts assuming one currency per company; revisit if orders can mix currencies.
  const total = { amount: [...current.values()].reduce((sum, order) => sum + order.total.amount, 0), currency: [...current.values()][0]?.total.currency ?? "" };
  return { orders: current, count: current.size, total, toggle, selectPage, clear };
}
