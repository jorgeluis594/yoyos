import { createInstance } from "i18next";
import { expect, test } from "vitest";
import resources from "@core/app/locales";
import { applyRateRecovery, saleOutcome } from "@core/src/features/orders/presentation/new-sale-outcome";
import { initialDraft } from "@core/src/features/orders/presentation/order-view-state";

const i18n = createInstance();
await i18n.init({ lng: "es", resources, interpolation: { escapeValue: false } });
const variantId = "00000000-0000-4000-8000-000000000003";
const context = { t: i18n.t.bind(i18n), formatMoney: (money: { amount: number }) => `S/ ${money.amount.toFixed(2)}`, orderPath: "/es-PE/orders/o1" };
const refuse = (code: string, patch: object = {}) => ({ code, error: "private", ...patch });

test("marks the unavailable line and moves focus to it", () => {
  const outcome = saleOutcome(refuse("VARIANT_NOT_FOUND", { variantId }), context);
  expect(outcome.unavailableVariantId).toBe(variantId);
  expect(outcome.notice).toMatchObject({ kind: "alert", focus: `order-line-${variantId}` });
});

test("asks the seller to review the new price and keeps it as the quoted one", () => {
  const outcome = saleOutcome(refuse("TOTAL_CHANGED", { currentPrice: { amount: 12, currency: "PEN" } }), context);
  expect(outcome.notice).toMatchObject({ text: "El precio de la entrega cambió a S/ 12.00. Revísalo y guarda de nuevo." });
  expect(outcome.rate).toEqual({ price: { amount: 12, currency: "PEN" } });
});

test("asks to choose another rate when the quoted one is gone", () => {
  for (const code of ["RATE_UNAVAILABLE", "DELIVERY_UNAVAILABLE", "DELIVERY_METHOD_DISABLED", "INVALID_DISTRICT"]) {
    const outcome = saleOutcome(refuse(code), context);
    expect(outcome.rate).toBe("clear");
    expect(outcome.notice).toMatchObject({ text: "Esa opción de entrega ya no está disponible. Elige otra." });
  }
});

test("marks the deliver-on-save box when there is no payment and says short stock apart", () => {
  expect(saleOutcome(refuse("PAYMENT_REQUIRED"), context)).toMatchObject({ coverRequired: true, notice: { text: "Para marcarlo entregado, registra al menos un pago. Puede ser un pago parcial." } });
  expect(saleOutcome(refuse("INSUFFICIENT_STOCK"), context)).toMatchObject({ coverRequired: false, notice: { text: "No hay stock suficiente para uno de los productos." } });
});

test("links an already registered sale instead of saving it again", () => {
  expect(saleOutcome(refuse("ORDER_ALREADY_EXISTS"), context).notice).toMatchObject({ link: { to: "/es-PE/orders/o1" } });
});

test("tells offline from in-doubt and asks to check only the second", () => {
  expect(saleOutcome({ lost: "offline" }, context)).toMatchObject({ check: false, notice: { text: "No se pudo guardar la venta. Revisa tu conexión e inténtalo de nuevo." } });
  expect(saleOutcome({ lost: "in-doubt" }, context)).toMatchObject({ check: true, notice: { kind: "doubt", checking: true } });
});

test("applies the rate recovery only to a chosen delivery", () => {
  const none = initialDraft({ kind: "new", orderId: "o1", currency: "PEN" });
  expect(applyRateRecovery(none, "clear")).toBe(none);
  const home = { ...none, draft: { ...none.draft, delivery: { ...none.draft.delivery, tab: "home" as const, fields: { ...none.draft.delivery.fields, rateId: "r1", agencyId: "a1", ratePrice: { amount: 8, currency: "PEN" as const } } } } };
  expect(applyRateRecovery(home, "clear").draft.delivery.fields).toMatchObject({ rateId: "", agencyId: "", ratePrice: null });
  const changed = applyRateRecovery(home, { price: { amount: 12, currency: "PEN" } });
  expect(changed.draft.delivery.fields).toMatchObject({ rateId: "", agencyId: "", ratePrice: null });
  expect(changed.quoteEpoch).toBe(1);
  expect(applyRateRecovery(changed, "clear").quoteEpoch).toBe(2);
  expect(applyRateRecovery(home, "keep")).toBe(home);
});
