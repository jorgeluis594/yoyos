import { createInstance } from "i18next";
import { expect, test } from "vitest";
import resources from "@core/app/locales";
import { countsText, meanwhileText, pointText, reasonText, rowTime, undoStep, changeSummary } from "@core/src/features/orders/presentation/order-review-texts";
import { doubtfulChange, point, reviewLine, sureChange } from "@core/src/features/orders/presentation/order-review.fixture";

const money = (amount: number) => `S/ ${amount.toFixed(2)}`;
async function translator(lng: string) {
  const i18n = createInstance();
  await i18n.init({ lng, resources, interpolation: { escapeValue: false } });
  return i18n.t.bind(i18n);
}

test("every doubt reason says what the message did in catalog terms, in both languages", async () => {
  const es = await translator("es");
  const pt = await translator("pt");
  const reasons = [
    { kind: "variant_changed", attribute: "Talla", from: "L", to: "M" }, { kind: "quantity_set", quantity: 3 }, { kind: "added_by_reference", quantity: 2, quote: null },
    { kind: "removed", product: "Gorra trucker" }, { kind: "price_noted", amount: 45, units: 1 }, { kind: "price_noted", amount: 45, units: 3 }, { kind: "caption_unread" },
    { kind: "inherited", from: { kind: "caption_unread" } },
  ] as const;
  expect(reasons.map((reason) => reasonText(reason, es, money, "PEN"))).toEqual([
    "Un mensaje cambió talla de L a M", "Un mensaje cambió la cantidad a 3", "Un mensaje agregó 2", "Un mensaje quitó Gorra trucker",
    "Un mensaje anotó que el cliente mencionó S/ 45.00 por unidad. El precio del pedido no cambió.", "Un mensaje anotó que el cliente mencionó S/ 45.00 por 3. El precio del pedido no cambió.",
    "No pudimos leer lo que escribió con la foto", "No pudimos leer lo que escribió con la foto (venía de un punto por resolver)"]);
  expect(reasonText(reasons[0], pt, money, "PEN")).toBe("Uma mensagem mudou talla de L para M");
  expect(reasonText(reasons[4], pt, money, "PEN")).toBe("Uma mensagem anotou que o cliente mencionou S/ 45.00 por unidade. O preço do pedido não mudou.");
});

test("points read as the notice title with the product, the units and what is missing", async () => {
  const es = await translator("es");
  expect(pointText(point(), es)).toBe("Falta la variante: Polo básico ×2 — falta talla.");
  expect(pointText(point({ product: null, kind: "not_clear", quantity: 1 }), es)).toBe("No quedó claro qué producto agregar ×1.");
});

test("message rows summarise the changes and the undo lists what it reverts", async () => {
  const es = await translator("es");
  const removed = sureChange({ kind: "removed", before: reviewLine("i", "v", "Gorra trucker", "Negro", 2, 40), after: null });
  expect(changeSummary(sureChange(), es)).toBe("Agregó Gorra trucker · Rojo · ×1");
  expect(changeSummary(removed, es)).toBe("Quitó Gorra trucker · Negro · ×2");
  expect(undoStep(removed, es)).toBe("Volver Gorra trucker · Negro · ×2");
  expect(undoStep(sureChange(), es)).toBe("Quitar Gorra trucker · Rojo · ×1");
  expect(undoStep(doubtfulChange(), es)).toBe("Volver Disfraz de Deadpool a talla L");
  expect(meanwhileText([sureChange()], "S/ 120.00", es)).toBe("Mientras revisabas, un mensaje agregó Gorra trucker · Rojo · ×1. Total: S/ 120.00.");
});

test("row times show the hour today and the date on another day, in Lima time", () => {
  const now = new Date("2026-10-30T22:00:00.000Z");
  expect(rowTime("2026-10-30T20:42:00.000Z", now, "es-PE")).toBe("15:42");
  expect(rowTime("2026-10-29T20:42:00.000Z", now, "es-PE")).toBe("29/10 15:42");
});

test("the counts name the doubtful changes and the points apart", async () => {
  const es = await translator("es");
  expect(countsText({ doubtfulCount: 1, pointCount: 0 }, es)).toBe("1 cambio con duda");
  expect(countsText({ doubtfulCount: 2, pointCount: 0 }, es)).toBe("2 cambios con duda");
  expect(countsText({ doubtfulCount: 0, pointCount: 1 }, es)).toBe("1 punto por resolver");
  expect(countsText({ doubtfulCount: 1, pointCount: 2 }, es)).toBe("1 cambio con duda · 2 por resolver");
  expect(countsText({ doubtfulCount: 0, pointCount: 0 }, es)).toBeNull();
});
