import { createInstance } from "i18next";
import { describe, expect, test } from "vitest";
import resources from "@core/app/locales";
import { deadpoolM, lineCatalog, loadedOrder, order1042, pen, revisions, savedState, trajeM } from "@core/src/features/orders/presentation/order-1042.fixture";
import { saveChangesOutcome } from "@core/src/features/orders/presentation/save-changes-outcome";
import { unsavedParts, type OrderViewState } from "@core/src/features/orders/presentation/order-view-state";

const i18n = createInstance();
await i18n.init({ lng: "es", resources, interpolation: { escapeValue: false } });
const context = { t: i18n.t.bind(i18n), formatMoney: (money: { amount: number }) => `S/ ${money.amount.toFixed(2)}` };

const typeQuantity = (state: OrderViewState, variantId: string, quantityText: string): OrderViewState =>
  ({ ...state, draft: { ...state.draft, items: state.draft.items.map((line) => line.variantId === variantId ? { ...line, quantityText } : line) } });
const edited = () => typeQuantity(savedState(), deadpoolM, "2");
const refuse = (code: string, patch: object = {}) => ({ operation: "save_changes" as const, code, ...patch });

describe("a saved save_changes", () => {
  const raised = order1042({ total: pen(418), itemsTotal: pen(418), balanceDue: pen(268),
    items: order1042().items.map((item) => item.variantId === deadpoolM ? { ...item, quantity: 2, subtotal: pen(240) } : item) });
  const saved = { operation: "save_changes" as const, order: raised, revisions: { ...revisions, items: "Z".repeat(43) }, lineCatalog, applied: ["items" as const] };

  test("pins the new state, clears the edits, announces it and asks for the heading focus", () => {
    const outcome = saveChangesOutcome(edited(), saved, context);
    expect(unsavedParts(outcome.state)).toEqual([]);
    expect(outcome.state.base?.items.revision).toBe("Z".repeat(43));
    expect(outcome.notice).toEqual({ kind: "success", text: "Cambios guardados." });
    expect(outcome.focusHeading).toBe(true);
    expect(outcome.bumpCatalog).toBe(true);
  });

  test("says the order waits for stock when the result is waiting", () => {
    const waiting = { ...saved, order: { ...raised, stockDue: { kind: "waiting" as const, shortItems: [{ variantId: deadpoolM, available: 0 }] } } };
    expect(saveChangesOutcome(edited(), waiting, context).notice).toEqual({ kind: "success", text: "Cambios guardados. El pedido queda esperando stock." });
  });
});

describe("a refused save_changes", () => {
  test("keeps every edit and shows the conflict alert for ORDER_CHANGED", () => {
    const outcome = saveChangesOutcome(edited(), refuse("ORDER_CHANGED", { parts: ["items"] }), context);
    expect(outcome.notice).toEqual({ kind: "conflict" });
    expect(unsavedParts(outcome.state)).toEqual(["items"]);
    expect(outcome.state.base?.items.revision).toBe(revisions.items);
  });

  test("asks for a revalidation that resets the products on ITEMS_LOCKED and one that keeps them on DELIVERY_LOCKED", () => {
    expect(saveChangesOutcome(edited(), refuse("ITEMS_LOCKED"), context)).toMatchObject({ notice: { kind: "itemsLocked" }, resetProducts: true });
    expect(saveChangesOutcome(edited(), refuse("DELIVERY_LOCKED"), context)).toMatchObject({ notice: { kind: "locked", code: "DELIVERY_LOCKED" }, resetProducts: false });
    expect(saveChangesOutcome(edited(), refuse("ORDER_CANCELLED"), context).notice).toEqual({ kind: "locked", code: "ORDER_CANCELLED" });
  });

  test("clears the stale rate and asks the place fields to quote again on TOTAL_CHANGED, without clearing the district", () => {
    const home = savedState();
    const state = { ...home, draft: { ...home.draft, delivery: { ...home.draft.delivery, fields: { ...home.draft.delivery.fields, districtCode: "150101" } } } };
    const outcome = saveChangesOutcome(state, refuse("TOTAL_CHANGED", { currentPrice: pen(12) }), context);
    expect(outcome.state.draft.delivery.fields).toMatchObject({ districtCode: "150101", rateId: "", agencyId: "", ratePrice: null });
    expect(outcome.state.quoteEpoch).toBe(1);
    expect(outcome.notice).toMatchObject({ kind: "alert", text: "El precio de la entrega cambió a S/ 12.00. Revísalo y guarda de nuevo.", focus: "order-delivery-rateId" });
  });

  test("clears the rate when it is no longer available", () => {
    const outcome = saveChangesOutcome(edited(), refuse("RATE_UNAVAILABLE"), context);
    expect(outcome.state.quoteEpoch).toBe(1);
    expect(outcome.state.draft.delivery.fields).toMatchObject({ rateId: "", ratePrice: null });
    expect(outcome.notice).toMatchObject({ text: "Esa opción de entrega ya no está disponible. Elige otra." });
  });

  test("marks a line that is no longer sold with a text that depends on whether it is saved", () => {
    const added = saveChangesOutcome(edited(), refuse("VARIANT_NOT_FOUND", { variantId: "new-variant" }), context);
    expect(added).toMatchObject({ unavailableVariantId: "new-variant", notice: { kind: "alert", focus: "order-line-new-variant", text: "Uno de los productos ya no está disponible." } });
    const kept = saveChangesOutcome(edited(), refuse("VARIANT_NOT_FOUND", { variantId: trajeM }), context);
    expect(kept.notice).toMatchObject({ text: "Este producto ya no se vende; puedes bajar la cantidad o quitarlo.", focus: `order-line-${trajeM}` });
  });

  test("answers persistence, business and malformed errors with generic texts that keep the edits", () => {
    expect(saveChangesOutcome(edited(), refuse("PERSISTENCE_UNAVAILABLE"), context).notice)
      .toMatchObject({ kind: "alert", text: "No se pudieron guardar los cambios. Revisa tu conexión e inténtalo de nuevo." });
    for (const code of ["INVALID_ORDER", "CURRENCY_MISMATCH", "INVALID_INPUT"]) expect(saveChangesOutcome(edited(), refuse(code), context).notice).toMatchObject({ kind: "alert", text: "Revisa los datos de la venta." });
    expect(unsavedParts(saveChangesOutcome(edited(), refuse("INVALID_INPUT"), context).state)).toEqual(["items"]);
  });
});

describe("a lost save_changes", () => {
  test("says nothing was sent when the request never left", () => {
    expect(saveChangesOutcome(edited(), { operation: "save_changes", lost: "offline" }, context))
      .toMatchObject({ notice: { kind: "alert", text: "No se pudieron guardar los cambios. Revisa tu conexión e inténtalo de nuevo." }, check: false });
  });

  test("starts the in-doubt check when the answer is unknown", () => {
    expect(saveChangesOutcome(edited(), { operation: "save_changes", lost: "in-doubt" }, context)).toMatchObject({ notice: { kind: "doubt", checking: true }, check: true });
  });
});

test("loadedOrder is the order the loader serves", () => {
  expect(loadedOrder().order.number).toBe(1042);
});
