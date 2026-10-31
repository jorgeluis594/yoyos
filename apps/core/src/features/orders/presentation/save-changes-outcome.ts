import type { TFunction } from "i18next";
import type { Money } from "@shared/money";
import type { OrderPart } from "@core/src/features/orders/domain/order-edit";
import type { EditOrderResult } from "@core/src/features/orders/presentation/order-edit-schemas";
import type { ViewNotice } from "@core/src/features/orders/presentation/order-view";
import { applySaveResult, type OrderViewState } from "@core/src/features/orders/presentation/order-view-state";
import { applyRateRecovery, type SaleOutcome } from "@core/src/features/orders/presentation/new-sale-outcome";

/** What the `save_changes` action answers: the saved order, a known refusal of core, or the lost answer of the client action. */
export type SaveChangesResult =
  | Readonly<{ operation: "save_changes" }> & EditOrderResult
  | Readonly<{ operation: "save_changes"; code: string; parts?: readonly OrderPart[]; variantId?: string; currentPrice?: Money }>
  | Readonly<{ operation: "save_changes"; lost: "offline" | "in-doubt" }>;

/** What the screen shows and does after **Guardar cambios**: the next state and the effects the route applies. */
export type SaveOutcome = Readonly<{
  state: OrderViewState;
  notice: ViewNotice | null;
  unavailableVariantId: string | null;
  /** After a save, focus goes to the page heading. */
  focusHeading: boolean;
  /** The picker's cached searches are stale: the stock changed. */
  bumpCatalog: boolean;
  /** `ITEMS_LOCKED`: the next loader answer returns the products to the saved ones. */
  resetProducts: boolean;
  /** The lost answer must be checked by reading the order. */
  check: boolean;
}>;

const rateGone = ["RATE_UNAVAILABLE", "DELIVERY_UNAVAILABLE", "DELIVERY_METHOD_DISABLED", "INVALID_DISTRICT"];

/** Maps the action's answer to the next state, the status line and the effects. Edits stay on screen unless the save went through. */
export function saveChangesOutcome(state: OrderViewState, result: SaveChangesResult, context: Readonly<{ t: TFunction; formatMoney: (money: Money) => string }>): SaveOutcome {
  const { t, formatMoney } = context;
  const stay = (notice: ViewNotice | null, patch: Partial<SaveOutcome> = {}): SaveOutcome => ({ state, notice, unavailableVariantId: null, focusHeading: false, bumpCatalog: false, resetProducts: false, check: false, ...patch });
  const alert = (text: string, focus?: string): ViewNotice => ({ kind: "alert", text, focus });
  if ("lost" in result) return result.lost === "offline" ? stay(alert(t("orderView.failure.changesOffline"))) : stay({ kind: "doubt", checking: true }, { check: true });
  if ("applied" in result) {
    const saved = { order: result.order, revisions: result.revisions, lineCatalog: result.lineCatalog, applied: result.applied };
    return stay({ kind: "success", text: t(result.order.stockDue?.kind === "waiting" ? "orderView.status.changesSavedWaiting" : "orderView.status.changesSaved") },
      { state: applySaveResult(state, saved), focusHeading: true, bumpCatalog: true });
  }
  switch (true) {
    case result.code === "ORDER_CHANGED": return stay({ kind: "conflict" });
    case result.code === "ITEMS_LOCKED": return stay({ kind: "itemsLocked" }, { resetProducts: true });
    case result.code === "DELIVERY_LOCKED" || result.code === "ORDER_CANCELLED": return stay({ kind: "locked", code: result.code });
    case result.code === "VARIANT_NOT_FOUND" && result.variantId !== undefined: {
      const variantId = result.variantId;
      const saved = state.base?.items.saved.some((line) => line.variantId === variantId) ?? false;
      return stay(alert(t(saved ? "orderView.products.deactivated" : "orders.variantMissing"), `order-line-${variantId}`), { unavailableVariantId: variantId });
    }
    case result.code === "TOTAL_CHANGED" && result.currentPrice !== undefined:
      return stay(alert(t("orderView.delivery.priceChanged", { amount: formatMoney(result.currentPrice) }), "order-delivery-rateId"), { state: applyRateRecovery(state, { price: result.currentPrice } satisfies SaleOutcome["rate"]) });
    case rateGone.includes(result.code): return stay(alert(t("orderView.delivery.unavailable"), "order-delivery-rateId"), { state: applyRateRecovery(state, "clear") });
    case result.code === "PERSISTENCE_UNAVAILABLE" || result.code === "SERVICE_UNAVAILABLE": return stay(alert(t("orderView.failure.changesOffline")));
    case result.code === "ORDER_NOT_FOUND": return stay(alert(t("orders.missing")));
    default: return stay(alert(t("orders.invalidOrder")));
  }
}
