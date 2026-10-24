import { useState } from "react";
import { emptySelection, toggleOrder, togglePage, type OrderLabelSelection, type SelectedOrder } from "@core/src/features/orders/presentation/order-label-selection";

/** Selection that lives as long as the list does and starts empty again whenever the `scope` (filters, search, view, company) changes. */
export function useOrderLabelSelection(scope: string) {
  const [state, setState] = useState<{ scope: string; selection: OrderLabelSelection }>({ scope, selection: emptySelection });
  const selection = state.scope === scope ? state.selection : emptySelection;
  const update = (change: (current: OrderLabelSelection) => OrderLabelSelection) => setState({ scope, selection: change(selection) });
  return {
    selection,
    toggle: (order: SelectedOrder) => update((current) => toggleOrder(current, order)),
    togglePage: (page: readonly SelectedOrder[]) => update((current) => togglePage(current, page)),
    clear: () => update(() => emptySelection),
  };
}
