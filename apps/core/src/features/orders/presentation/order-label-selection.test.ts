import { expect, test } from "vitest";
import { dispatchLabelMaxOrders } from "@shared/contracts/dispatch-labels";
import { emptySelection, pageSelectionState, selectionScope, skipReason, summarizeSelection, toggleOrder, togglePage, type SelectedOrder } from "@core/src/features/orders/presentation/order-label-selection";

const order = (number: number, deliveryMethod: SelectedOrder["deliveryMethod"] = "home", status: SelectedOrder["status"] = "active"): SelectedOrder =>
  ({ id: `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`, number, deliveryMethod, status });

test("the selection keeps orders from other pages and unchecking removes only that order", () => {
  const first = toggleOrder(emptySelection, order(1));
  const both = toggleOrder(first, order(21));

  expect(Object.values(both).map((item) => item.number)).toEqual([1, 21]);
  expect(Object.values(toggleOrder(both, order(1))).map((item) => item.number)).toEqual([21]);
});

test("the page checkbox is empty, indeterminate or checked, selects the page and unselects only that page", () => {
  const page = [order(1), order(2), order(3)];
  const otherPage = order(21);
  expect(pageSelectionState(emptySelection, page)).toBe("empty");

  const some = toggleOrder(emptySelection, page[1]!);
  expect(pageSelectionState(some, page)).toBe("some");

  const all = togglePage(toggleOrder(some, otherPage), page);
  expect(pageSelectionState(all, page)).toBe("all");
  expect(Object.keys(all)).toHaveLength(4);

  const cleared = togglePage(all, page);
  expect(Object.values(cleared).map((item) => item.number)).toEqual([21]);
});

test.each([
  [order(1, "none", "cancelled"), "cancelled"],
  [order(2, "none"), "none"],
  [order(3, "pickup"), "pickup"],
  [order(4, "home"), null],
  [order(5, "agency", "completed"), null],
])("order %#: predicts its skip reason", (item, reason) => {
  expect(skipReason(item)).toBe(reason);
});

test("the summary counts each reason and leaves the printable ids for the button", () => {
  const selection = [order(1), order(2, "agency"), order(3, "none"), order(4, "pickup"), order(5, "home", "cancelled")].reduce(toggleOrder, emptySelection);

  const summary = summarizeSelection(selection);

  expect(summary).toMatchObject({ total: 5, skipped: { none: 1, pickup: 1, cancelled: 1 }, skippedTotal: 3, overLimit: false });
  expect(summary.printableIds).toEqual([order(1).id, order(2, "agency").id]);
});

test("more than the endpoint limit is flagged and exactly the limit is not", () => {
  const orders = Array.from({ length: dispatchLabelMaxOrders + 1 }, (_, index) => order(index + 1));

  expect(summarizeSelection(togglePage(emptySelection, orders)).overLimit).toBe(true);
  expect(summarizeSelection(togglePage(emptySelection, orders.slice(1))).overLimit).toBe(false);
});

test("the scope ignores the page but changes with any filter, search, view or locale base", () => {
  const filters = { customer: "all", view: "all" } as const;
  const scope = selectionScope("/es-PE/orders", filters);

  expect(selectionScope("/es-PE/orders", { ...filters, view: undefined })).toBe(scope);
  for (const changed of [{ customer: "general_public" }, { search: "ana" }, { view: "unpaid" }, { createdFrom: "2026-10-01T05:00:00.000Z" }, { createdBefore: "2026-10-02T05:00:00.000Z" }])
    expect(selectionScope("/es-PE/orders", { ...filters, ...changed })).not.toBe(scope);
  expect(selectionScope("/pt-BR/orders", filters)).not.toBe(scope);
});
