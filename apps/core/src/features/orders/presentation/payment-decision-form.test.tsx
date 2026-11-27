// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { afterEach, expect, test, vi } from "vitest";
import resources from "@core/app/locales";
import { PaymentDecisionForm } from "@core/src/features/orders/presentation/payment-decision-form";
import { catalogPaymentOptions } from "@core/src/features/orders/presentation/payment-options";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const i18n = createInstance();
await i18n.use(initReactI18next).init({ lng: "es", resources, interpolation: { escapeValue: false } });
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
    <PaymentDecisionForm kind="register" paymentId="p-1" order={order} heading={false} fetcher={fetcher} onSubmit={() => undefined} onCancel={() => undefined} options={catalogPaymentOptions} initialChoice={initialChoice} /></I18nextProvider>));
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

const plain = (text: string | null | undefined) => (text ?? "").replace(/\u00a0/g, " ");
const typeAmount = (value: string) => act(() => {
  const input = container.querySelector<HTMLInputElement>("input[name=amount]")!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
async function mountForm(kind: "approve" | "register", balance: number) {
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  const reportOrder = { ...order, balanceDue: { amount: balance, currency: "PEN" as const }, total: { amount: 60, currency: "PEN" as const } };
  await act(async () => root!.render(<I18nextProvider i18n={i18n}>
    <PaymentDecisionForm kind={kind} paymentId="p-1" order={reportOrder} heading={false} fetcher={{ state: "idle", submit: vi.fn() } as never} onSubmit={() => undefined} onCancel={() => undefined} options={catalogPaymentOptions} /></I18nextProvider>));
}
const submitButton = () => container.querySelector<HTMLButtonElement>("button[type=submit]")!;

test("approving a report above the balance shows the balance and disables approving", async () => {
  await mountForm("approve", 60);
  expect(submitButton().disabled).toBe(false);
  typeAmount("999");
  expect(plain(container.textContent)).toContain("Supera el saldo pendiente de S/ 60.00");
  expect(submitButton().disabled).toBe(true);
});

test("a report on a paid order cannot be approved, says to reject a repeated receipt, and can still be rejected", async () => {
  await mountForm("approve", 0);
  expect(container.textContent).toContain("Este pedido ya está pagado. Si el comprobante repite un pago que ya registraste, recházalo: el motivo que escribas lo verá el comprador.");
  expect(submitButton().disabled).toBe(true);
  expect(container.querySelector("input[name=amount]")).toBeNull();
  act(() => root!.unmount());
  container.remove();
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () => root!.render(<I18nextProvider i18n={i18n}>
    <PaymentDecisionForm kind="reject" paymentId="p-1" order={{ ...order, balanceDue: { amount: 0, currency: "PEN" as const } }} heading={false} fetcher={{ state: "idle", submit: vi.fn() } as never} onSubmit={() => undefined} onCancel={() => undefined} options={catalogPaymentOptions} /></I18nextProvider>));
  expect(submitButton().disabled).toBe(false);
});
