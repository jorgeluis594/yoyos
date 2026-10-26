import { expect, test } from "vitest";
import { addOption, createDraft, removeRow, removeValue, type EditorDraft } from "@shared/product-variants";
import { feedbackTargets, newRowsInRequestOrder, rowViews, stockTotal } from "@core/src/features/products/presentation/product-editor-model";
import type { FeedbackIssue } from "@core/src/features/products/presentation/messages";

let counter = 0;
const id = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
const must = <T>(result: { success: true; data: T } | { success: false; error: { code: string } }): T => {
  if (!result.success) throw new Error(result.error.code);
  return result.data;
};
const poloDraft = (): EditorDraft => {
  const talla = { id: id(), name: "Talla", values: ["S", "M"].map((name) => ({ id: id(), name })) };
  const color = { id: id(), name: "Color", values: ["Negro", "Azul"].map((name) => ({ id: id(), name })) };
  return must(addOption(must(addOption(createDraft({ sku: null, salePrice: 39.9, purchasePrice: null, stock: 4 }), talla)), color));
};

test("marks the new rows and totals the stock of the rows that remain", () => {
  const draft = poloDraft();
  expect(rowViews(draft).map((view) => [view.label, view.tag])).toEqual([["S / Negro", "new"], ["S / Azul", "new"], ["M / Negro", "new"], ["M / Azul", "new"]]);
  expect(stockTotal(draft)).toBe(16);
  const azul = rowViews(draft).find((view) => view.label === "S / Azul")!;
  const removed = must(removeRow(draft, azul.row.ref));
  expect(rowViews(removed).find((view) => view.label === "S / Azul")).toMatchObject({ removal: "self", tag: "removed" });
  expect(stockTotal(removed)).toBe(12);
});

test("lists the new rows in the order the request sends them, skipping removed ones", () => {
  const draft = poloDraft();
  const [first, ...rest] = rowViews(draft);
  const removed = must(removeRow(draft, first.row.ref));
  expect(newRowsInRequestOrder(removed).map((row) => row.ref)).toEqual(rest.map((view) => view.row.ref));
});

test("places rejected rows by request index and a refused deletion on its value", () => {
  const draft = poloDraft();
  const issue = (partial: Partial<FeedbackIssue>): FeedbackIssue => ({ scope: "newVariant", field: "sku", reason: "DUPLICATE_SKU", message: "SKU en uso por otra variante", ...partial });
  const targets = feedbackTargets(draft, [issue({ index: 1 }), issue({ scope: "option", optionId: draft.options[0].id, message: "Máximo 100 variantes" }), issue({ scope: "value", valueId: draft.options[1].values[0].id, message: "x" })]);
  expect(targets.rows).toEqual({ [newRowsInRequestOrder(draft)[1].ref]: "SKU en uso por otra variante" });
  expect(targets.options).toEqual({ [draft.options[0].id]: "Máximo 100 variantes" });
  expect(targets.values).toEqual({ [draft.options[1].values[0].id]: "x" });
});

test("a saved variant refused for orders blocks the value that was marked", () => {
  const saved: EditorDraft = { ...poloDraft(), saved: true };
  const withIds: EditorDraft = { ...saved, rows: saved.rows.map((row, index) => ({ ...row, id: `00000000-0000-4000-8000-9999000000${index}`, hasOrders: index === 3 })) };
  const azul = withIds.options[1].values[1];
  const marked = must(removeValue({ ...withIds, rows: withIds.rows.map((row) => ({ ...row, hasOrders: false, stock: 0 })) }, azul.id));
  const targets = feedbackTargets(marked, [{ scope: "variant", variantId: withIds.rows[3].id as string, field: "id", reason: "VARIANT_HAS_ORDERS", message: "Tiene pedidos" }]);
  expect([...targets.blockedValues]).toEqual([azul.id]);
  expect(targets.rows).toEqual({});
});
