import type { TFunction } from "i18next";
import type { Money } from "@shared/money";
import type { ViewNotice } from "@core/src/features/orders/presentation/order-view";
import type { DeliveryFields, OrderViewState } from "@core/src/features/orders/presentation/order-view-state";

/** What «Nueva venta» gets back from its action: a known refusal of core, or the lost answer of the client action. */
export type SaleActionResult =
  | Readonly<{ code: string; error: string; currentPrice?: Money; variantId?: string }>
  | Readonly<{ lost: "offline" | "in-doubt" }>;

/** What the screen shows and does after a refused or lost save; the draft itself stays as the seller left it, except for the delivery rate. */
export type SaleOutcome = Readonly<{
  notice: ViewNotice | null;
  unavailableVariantId: string | null;
  /** The payments do not cover «Marcar como entregado al guardar». */
  coverRequired: boolean;
  /** The quoted price changed, or the rate is gone: the delivery card must have the seller review the rate. */
  rate: "keep" | "clear" | Readonly<{ price: Money }>;
  /** The lost answer must be checked by reading the order. */
  check: boolean;
}>;

const rateGone = ["RATE_UNAVAILABLE", "DELIVERY_UNAVAILABLE", "DELIVERY_METHOD_DISABLED", "INVALID_DISTRICT"];

const outcome = (patch: Partial<SaleOutcome>): SaleOutcome => ({ notice: null, unavailableVariantId: null, coverRequired: false, rate: "keep", check: false, ...patch });

/** Maps the action's answer to the status line, the marks and the rate recovery. */
export function saleOutcome(result: SaleActionResult, context: Readonly<{ t: TFunction; formatMoney: (money: Money) => string; orderPath: string }>): SaleOutcome {
  const { t, formatMoney, orderPath } = context;
  const alert = (text: string, focus?: string, link?: Readonly<{ to: string; label: string }>): ViewNotice => ({ kind: "alert", text, focus, link });
  if ("lost" in result) return result.lost === "offline"
    ? outcome({ notice: alert(t("orderView.failure.saleOffline")) })
    : outcome({ notice: { kind: "doubt", checking: true }, check: true });
  switch (true) {
    case result.code === "VARIANT_NOT_FOUND" && result.variantId !== undefined:
      return outcome({ unavailableVariantId: result.variantId ?? null, notice: { kind: "alert", text: t("orders.variantMissing"), focus: `order-line-${result.variantId}` } });
    case result.code === "INSUFFICIENT_STOCK": return outcome({ notice: alert(t("orderView.delivery.noStock"), "order-delivery-deliverImmediately") });
    case result.code === "PAYMENT_REQUIRED": return outcome({ coverRequired: true, notice: alert(t("orderView.delivery.coverPayments"), "order-delivery-deliverImmediately") });
    case result.code === "TOTAL_CHANGED" && result.currentPrice !== undefined:
      return outcome({ rate: { price: result.currentPrice }, notice: alert(t("orderView.delivery.priceChanged", { amount: formatMoney(result.currentPrice) }), "order-delivery-rateId") });
    case rateGone.includes(result.code): return outcome({ rate: "clear", notice: alert(t("orderView.delivery.unavailable"), "order-delivery-rateId") });
    case result.code === "ORDER_ALREADY_EXISTS": return outcome({ notice: alert(t("orders.alreadyExists"), undefined, { to: orderPath, label: t("orderView.header.viewSale") }) });
    case result.code === "CURRENCY_MISMATCH": return outcome({ notice: alert(t("orders.currencyMismatch")) });
    case result.code === "PERSISTENCE_UNAVAILABLE": return outcome({ notice: alert(t("orders.saveError")) });
    default: return outcome({ notice: alert(t("orders.invalidOrder")) });
  }
}

/** Applies the rate recovery to the draft: a changed price becomes the one the seller reviews, a vanished rate is picked again. */
export function applyRateRecovery(state: OrderViewState, rate: SaleOutcome["rate"]): OrderViewState {
  if (rate === "keep" || state.draft.delivery.tab === "none") return state;
  const { delivery } = state.draft;
  const fields: DeliveryFields = rate === "clear" ? { ...delivery.fields, rateId: "", agencyId: "", ratePrice: null } : { ...delivery.fields, ratePrice: rate.price };
  return { ...state, draft: { ...state.draft, delivery: { ...delivery, fields } } };
}

const savedMarkKey = "order-view-saved";

/** A new sale that was saved lands on the saved view, which announces «Venta guardada.»: the mark survives the navigation, which can be the action's own redirect. */
export function markSaleSaved(orderId: string): void {
  try { sessionStorage.setItem(savedMarkKey, orderId); } catch { /* storage is optional: the view then only skips the announcement */ }
}

/** Whether the saved view of this order was reached from its own **Guardar venta**. */
export function readSaleSaved(orderId: string): boolean {
  try { return sessionStorage.getItem(savedMarkKey) === orderId; } catch { return false; }
}

/** The saved view consumed the mark: a later visit to the same order is an ordinary one. */
export function clearSaleSaved(orderId: string): void {
  try { if (sessionStorage.getItem(savedMarkKey) === orderId) sessionStorage.removeItem(savedMarkKey); } catch { /* nothing to clear */ }
}
