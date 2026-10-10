// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test } from "vitest";
import type { CheckoutDeliveryDraft } from "@core/app/components/checkout-delivery-fields";
import { CheckoutShell, checkoutTotal } from "@core/app/components/checkout-sections";
import { previewCheckout } from "@core/src/features/checkout-appearance/presentation/preview-fixtures";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const pending = previewCheckout("Lima Studio", "review");
const replace = { delivery: { kind: "replace" }, price: { amount: 10, currency: "PEN" } } as unknown as CheckoutDeliveryDraft;
const keep = { delivery: { kind: "keep" }, price: { amount: 0, currency: "PEN" } } as unknown as CheckoutDeliveryDraft;

describe("checkoutTotal", () => {
  test("is the order total once confirmed", () => {
    const confirmed = previewCheckout("Lima Studio", "payment");
    expect(checkoutTotal(confirmed, null)).toEqual(confirmed.total);
  });
  test("is unknown while pending without a delivery choice", () => {
    expect(checkoutTotal(pending, null)).toBeNull();
  });
  test("adds the chosen delivery price to the items while pending", () => {
    expect(checkoutTotal(pending, replace)).toEqual({ amount: 128, currency: "PEN" });
  });
  test("keeps the order total when the saved delivery is kept", () => {
    expect(checkoutTotal(pending, keep)).toEqual(pending.total);
  });
});

describe("CheckoutShell", () => {
  test("puts the brand inside the header with the order title", () => {
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    act(() => root.render(<CheckoutShell appearance={null} checkout={pending}><p>Contenido</p></CheckoutShell>));
    const header = container.querySelector("header")!;
    expect(header.textContent).toContain("Lima Studio");
    expect(header.querySelector("h1")?.textContent).toBe("Pedido #1001");
    act(() => root.unmount());
  });
});
