// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { afterEach, expect, test, vi } from "vitest";
import resources from "@core/app/locales";
import { PaymentDecisionForm } from "@core/src/features/orders/presentation/payment-decision-form";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const i18n = createInstance();
await i18n.use(initReactI18next).init({ lng: "es", resources });
let root: Root | undefined;
let container: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); root = undefined; container.remove(); });

const order = { stockDeducted: false, balanceDue: { amount: 268, currency: "PEN" as const }, total: { amount: 418, currency: "PEN" as const } };

async function submitWith(initialChoice?: "yape" | "plin" | "bank_transfer") {
  const submit = vi.fn();
  const fetcher = { state: "idle", submit } as never;
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () => root!.render(<I18nextProvider i18n={i18n}>
    <PaymentDecisionForm kind="register" paymentId="p-1" order={order} heading={false} fetcher={fetcher} onSubmit={() => undefined} onCancel={() => undefined} initialChoice={initialChoice} /></I18nextProvider>));
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  return submit.mock.calls[0]![0] as FormData;
}

test("opens with the first wallet when no method is preset", async () => {
  const body = await submitWith();
  expect([body.get("method"), body.get("walletProvider")]).toEqual(["digital_wallet", "yape"]);
});

test("opens with the preset wallet and keeps the balance prefilled", async () => {
  const body = await submitWith("plin");
  expect([body.get("method"), body.get("walletProvider"), body.get("amount")]).toEqual(["digital_wallet", "plin", "268.00"]);
});

test("opens with a preset bank transfer and no wallet provider", async () => {
  const body = await submitWith("bank_transfer");
  expect([body.get("method"), body.get("walletProvider")]).toEqual(["bank_transfer", null]);
});
