import type { TFunction } from "i18next";
import i18n from "@mobile/i18n";
import { countsText, messageRowSummary, reasonText, rowTimeLabel, undoConfirmationLines, undoRefusalText } from "@mobile/features/orders/presentation/order-review-model";
import { reviewChange, reviewLine } from "@mobile/features/orders/testing/order-review-fixtures";

const t = i18n.t.bind(i18n) as TFunction;
const money = (amount: number) => `S/ ${amount.toFixed(2)}`;
beforeAll(async () => { await i18n.changeLanguage("es"); });

test("reasons say what the message did in catalog terms", () => {
  const ctx = { t, money };
  expect(reasonText({ kind: "variant_changed", attribute: "Talla", from: "L", to: "M" }, ctx)).toBe("Un mensaje cambió talla: de L a M");
  expect(reasonText({ kind: "variant_changed", attribute: "Estampado", from: "A", to: "B" }, ctx)).toBe("Un mensaje cambió estampado: de A a B");
  expect(reasonText({ kind: "quantity_set", quantity: 3 }, ctx)).toBe("Un mensaje cambió la cantidad a 3");
  expect(reasonText({ kind: "removed", product: "Gorra trucker" }, ctx)).toBe("Un mensaje quitó Gorra trucker");
  expect(reasonText({ kind: "caption_unread" }, ctx)).toBe("No pudimos leer lo que escribió con la foto");
  expect(reasonText({ kind: "price_noted", amount: 70, units: 1 }, ctx)).toBe("Un mensaje mencionó S/ 70.00 por unidad en un producto que no nombró");
  expect(reasonText({ kind: "price_noted", amount: 120, units: 2 }, ctx)).toBe("Un mensaje mencionó S/ 120.00 por 2 en un producto que no nombró");
  expect(reasonText({ kind: "inherited", from: { kind: "quantity_set", quantity: 3 } }, ctx)).toBe("Un mensaje cambió la cantidad a 3");
});

test("price_noted reads in Portuguese too", async () => {
  await i18n.changeLanguage("pt-BR");
  const pt = i18n.t.bind(i18n) as TFunction;
  expect(reasonText({ kind: "price_noted", amount: 70, units: 1 }, { t: pt, money })).toBe("Uma mensagem mencionou S/ 70.00 por unidade em um produto que não nomeou");
  expect(reasonText({ kind: "variant_changed", attribute: "Tamanho", from: "L", to: "M" }, { t: pt, money })).toBe("Uma mensagem mudou tamanho: de L para M");
  await i18n.changeLanguage("es");
});

test("a row summarises the message in catalog terms, with its time", () => {
  const added = reviewChange(1, { kind: "added", before: null, after: reviewLine(1, { productName: "Polo básico", variantAttributes: { Talla: "M" }, quantity: 2 }) });
  const removed = reviewChange(2, { kind: "removed", before: reviewLine(2, { productName: "Gorra trucker", variantAttributes: { Color: "Negro" }, quantity: 2 }), after: null });
  expect(messageRowSummary([added, removed], t)).toBe("Agregó Polo básico · M · ×2 · Quitó Gorra trucker · Negro · ×2");
  const quantity = reviewChange(3, { kind: "quantity_changed", before: reviewLine(3, { quantity: 1 }), after: reviewLine(3, { quantity: 3 }) });
  expect(messageRowSummary([quantity], t)).toBe("Cambió Polera gris · M a ×3");
  expect(messageRowSummary([reviewChange(4)], t)).toBe("Cambió Polera gris a talla M");
});

test("the row time shows the date only when it is not today, in Lima time", () => {
  const now = new Date("2026-10-31T20:00:00.000Z");
  expect(rowTimeLabel("2026-10-31T20:42:00.000Z", now, "es-PE")).toBe("15:42");
  expect(rowTimeLabel("2026-10-30T20:42:00.000Z", now, "es-PE")).toBe("30/10 15:42");
});

test("counts name marks and points, and say nothing for sure changes", () => {
  expect(countsText({ doubtfulCount: 1, pointCount: 0 }, t)).toBe("1 cambio con duda");
  expect(countsText({ doubtfulCount: 2, pointCount: 0 }, t)).toBe("2 cambios con duda");
  expect(countsText({ doubtfulCount: 0, pointCount: 1 }, t)).toBe("1 punto por resolver");
  expect(countsText({ doubtfulCount: 0, pointCount: 2 }, t)).toBe("2 puntos por resolver");
  expect(countsText({ doubtfulCount: 1, pointCount: 2 }, t)).toBe("1 cambio con duda · 2 por resolver");
  expect(countsText({ doubtfulCount: 0, pointCount: 0 }, t)).toBeNull();
});

test("the undo confirmation lists what each change reverts, and a refusal names the sold-out product", () => {
  const added = reviewChange(1, { kind: "added", before: null, after: reviewLine(1, { productName: "Gorra trucker", variantAttributes: { Color: "Negro" }, quantity: 2 }) });
  expect(undoConfirmationLines([added, reviewChange(2)], t)).toEqual(["Quitar Gorra trucker · Negro · ×2", "Volver Polera gris a talla L"]);
  const removed = reviewChange(3, { kind: "removed", before: reviewLine(3, { productName: "Gorra trucker", variantAttributes: { Color: "Negro" } }), after: null });
  expect(undoRefusalText("not_sold", [removed], t)).toBe("Gorra trucker · Negro ya no se vende.");
  expect(undoRefusalText("later_change", [], t)).toBe("Un cambio posterior tocó este producto.");
  expect(undoRefusalText("would_empty", [], t)).toBe("Dejaría el pedido sin productos.");
  expect(undoRefusalText("order_moved_on", [], t)).toBe("El pedido ya avanzó.");
});
