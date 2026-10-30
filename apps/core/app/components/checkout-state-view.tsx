import { useEffect, useRef, useState } from "react";
import { useLoaderData } from "react-router";
import type { PublicCheckoutResponse } from "@shared/contracts/order-checkout";
import type { BuyerPaymentView } from "@shared/contracts/orders";
import { CheckoutBuyerDetails, CheckoutCancelledNotice, CheckoutOrderSummary, CheckoutPayment, CheckoutShell } from "@core/app/components/checkout-sections";
import { checkoutScreen, focusTargetFor, type CheckoutScreen } from "@core/src/features/orders/presentation/buyer-checkout-screen";
import { CheckoutClosingCard } from "@core/src/features/orders/presentation/checkout-closing-card";
import type { PublicStoreAppearance } from "@core/src/features/store-appearance/presentation/store-appearance-schemas";

/** A confirmed checkout always arrives with its payment view (the loader answers 503 otherwise); without one the page shows the buyer details only. */
function screenFor(checkout: PublicCheckoutResponse, payment: BuyerPaymentView | null): CheckoutScreen | null {
  if (checkout.state.kind === "cancelled") return checkoutScreen({ state: "cancelled" });
  return checkout.state.kind === "confirmed" && payment ? checkoutScreen({ state: "confirmed", view: payment }) : null;
}

/** Every non-pending checkout: the header slot, the buyer details and the payment step read the same screen, and focus follows it after «Ya pagué». */
export function CheckoutStateView({ appearance, checkout, payment }: Readonly<{
  appearance: PublicStoreAppearance | null; checkout: PublicCheckoutResponse; payment: BuyerPaymentView | null;
}>) {
  const loaderData = useLoaderData();
  // The loader data of the render that sent the report (the callback closes over it): focus waits for the refreshed screen, which brings different data.
  const intent = useRef<{ data: unknown } | null>(null);
  const [settled, setSettled] = useState(0);
  const screen = screenFor(checkout, payment);
  useEffect(() => {
    if (!intent.current || intent.current.data === loaderData) return;
    const target = screen ? focusTargetFor(screen) : null;
    if (target) document.getElementById(target)?.focus();
    intent.current = null;
  }, [settled, loaderData, screen]);
  return <CheckoutShell appearance={appearance} checkout={checkout}
    headerNotice={screen?.kind === "cancelled" ? <CheckoutCancelledNotice /> : screen?.kind === "closing" ? <CheckoutClosingCard receipts={screen.receipts} /> : null}
    summary={<CheckoutOrderSummary checkout={checkout} deliveryDraft={null} />}>
    <CheckoutBuyerDetails buyer={checkout.buyer} delivery={checkout.delivery} />
    {checkout.state.kind === "confirmed" && payment && <CheckoutPayment view={payment} onReportSettled={() => { intent.current = { data: loaderData }; setSettled((count) => count + 1); }} />}
  </CheckoutShell>;
}
