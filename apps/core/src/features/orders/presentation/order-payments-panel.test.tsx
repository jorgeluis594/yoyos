// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createRoutesStub } from "react-router";
import { afterEach, expect, test } from "vitest";
import resources from "@core/app/locales";
import type { OrderAggregateResponse } from "@shared/contracts/orders";
import type { PaymentRow } from "@core/src/features/orders/presentation/order-view-state";
import { OrderPaymentsPanel, paymentsSummary, type PaymentsPanelProps } from "@core/src/features/orders/presentation/order-payments-panel";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const i18n = createInstance();
await i18n.use(initReactI18next).init({ lng: "es", resources, interpolation: { escapeValue: false } });
let root: Root | undefined;
let container: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); root = undefined; container.remove(); });

const money = (amount: number) => ({ amount, currency: "PEN" as const });
const format = { amount: (value: { amount: number }) => `S/ ${value.amount.toFixed(2)}`, date: (iso: string) => iso.slice(0, 10) };
const confirmed = { id: "p-1", status: "confirmed", amount: money(150), method: "digital_wallet", walletProvider: "yape",
  data: { confirmedAt: "2026-10-29T10:00:00.000Z", evidence: { kind: "manual" } } };
const reported = { id: "p-2", status: "reported", amount: null, method: null, data: { reportedAt: "2026-10-30T10:00:00.000Z" } };
const rejected = { id: "p-3", status: "rejected", amount: null, method: null, data: { rejectedAt: "2026-10-28T10:00:00.000Z", reason: "Borroso", report: { reportedAt: "2026-10-27T10:00:00.000Z" } } };
const voided = { id: "p-4", status: "voided", amount: money(20), method: "bank_transfer", data: { confirmedAt: "2026-10-26T10:00:00.000Z", evidence: { kind: "manual" } } };
function savedOrder(overrides: Record<string, unknown> = {}) {
  return { number: 1042, cancelled: false, stockDeducted: false, total: money(418), paidAmount: money(150), balanceDue: money(268), overpaidAmount: money(0),
    deliveryCharge: money(0), payments: [confirmed], ...overrides } as unknown as OrderAggregateResponse;
}
const savedProps = (order: OrderAggregateResponse, extra: Record<string, unknown> = {}) =>
  ({ mode: "saved", order, receiptUrls: {}, manualPaymentId: "new-payment", voidResult: undefined, unsavedChanges: false, hasProducts: true, format, ...extra }) as unknown as PaymentsPanelProps;
const estimate = (total: number, paid: number) => ({ total: money(total), paid: money(paid), balance: money(Math.max(total - paid, 0)), excess: money(Math.max(paid - total, 0)) });

async function mount(element: React.ReactElement) {
  const Stub = createRoutesStub([{ path: "*", Component: () => element }]);
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () => root!.render(<I18nextProvider i18n={i18n}><Stub initialEntries={["/"]} /></I18nextProvider>));
}
const buttons = () => [...container.querySelectorAll<HTMLButtonElement>("button:not([data-testid])")];
const buttonNamed = (text: string) => buttons().find(button => button.textContent === text || button.getAttribute("aria-label")?.startsWith(text));
const amountInputs = () => [...container.querySelectorAll<HTMLInputElement>("input[name=amount]")];
const type = (input: HTMLInputElement, value: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
});

function NewSale({ total: initialTotal, products = true, initial = [], togglable = false }: { total: number; products?: boolean; initial?: PaymentRow[]; togglable?: boolean }) {
  const [payments, setPayments] = useState<readonly PaymentRow[]>(initial);
  const [total, setTotal] = useState(initialTotal);
  const paid = payments.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  let next = 0;
  return <>
    {togglable && <button type="button" data-testid="products-change" onClick={() => setTotal(total + 100)} />}
    <OrderPaymentsPanel mode="new" hasProducts={products} format={format} payments={payments} onChange={setPayments}
      estimate={estimate(total, paid)} newPaymentId={() => `draft-${++next}`} />
  </>;
}

test("shows one button per wallet of the country plus bank transfer", async () => {
  await mount(<NewSale total={418} />);
  expect(buttons().map(button => button.textContent)).toEqual(["Agregar Yape", "Agregar Plin", "Transferencia bancaria"]);
  act(() => root!.unmount());
  container.remove();
  await mount(<OrderPaymentsPanel {...savedProps(savedOrder())} />);
  expect(buttons().map(button => button.textContent)).toEqual(expect.arrayContaining(["Agregar Yape", "Agregar Plin", "Transferencia bancaria"]));
});

test("adds a draft row prefilled with the balance and removes it with Quitar", async () => {
  await mount(<NewSale total={418} />);
  act(() => buttonNamed("Agregar Plin")!.click());
  expect(amountInputs().map(input => input.value)).toEqual(["418.00"]);
  expect(container.textContent).toContain("Plin");
  act(() => buttonNamed("Quitar")!.click());
  expect(amountInputs()).toHaveLength(0);
  expect(container.textContent).toContain("Aún no hay pagos registrados.");
});

test("keeps a typed draft amount when products change", async () => {
  await mount(<NewSale total={418} togglable />);
  act(() => buttonNamed("Agregar Yape")!.click());
  type(amountInputs()[0]!, "150");
  act(() => container.querySelector<HTMLButtonElement>("[data-testid=products-change]")!.click());
  expect(amountInputs()[0]!.value).toBe("150");
});

test("says to add products first and offers no payment button without products", async () => {
  await mount(<NewSale total={0} products={false} />);
  expect(container.textContent).toContain("Agrega productos para registrar pagos.");
  expect(buttons()).toHaveLength(0);
});

test("hides the payment buttons once the balance is zero and on a cancelled order", async () => {
  await mount(<OrderPaymentsPanel {...savedProps(savedOrder({ balanceDue: money(0), paidAmount: money(418) }))} />);
  expect(buttonNamed("Agregar Yape")).toBeUndefined();
  act(() => root!.unmount());
  container.remove();
  await mount(<OrderPaymentsPanel {...savedProps(savedOrder({ cancelled: true }))} />);
  expect(buttonNamed("Agregar Yape")).toBeUndefined();
  expect(buttonNamed("Anular pago")).toBeDefined();
});

test("keeps Anular pago and Rechazar enabled while there are unsaved changes", async () => {
  await mount(<OrderPaymentsPanel {...savedProps(savedOrder({ payments: [confirmed, reported] }), { unsavedChanges: true })} />);
  for (const name of ["Anular pago", "Rechazar"]) {
    const button = buttonNamed(name)!;
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-disabled")).toBeNull();
  }
  expect(buttonNamed("Ver captura")?.getAttribute("aria-disabled") ?? null).toBeNull();
});

test("disables Agregar Yape with its note while there are unsaved changes", async () => {
  await mount(<OrderPaymentsPanel {...savedProps(savedOrder({ payments: [confirmed, reported] }), { unsavedChanges: true })} />);
  for (const name of ["Agregar Yape", "Agregar Plin", "Transferencia bancaria", "Aprobar"]) {
    const button = buttonNamed(name)!;
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.disabled).toBe(false);
    const note = document.getElementById(button.getAttribute("aria-describedby")!);
    expect(note?.textContent).toBe("Guarda o descarta los cambios primero.");
  }
  act(() => buttonNamed("Agregar Yape")!.click());
  expect(document.body.querySelector("[role=dialog]")).toBeNull();
});

test("opens the payment form with the wallet preset and the balance prefilled", async () => {
  await mount(<OrderPaymentsPanel {...savedProps(savedOrder())} />);
  act(() => buttonNamed("Agregar Plin")!.click());
  const dialog = document.body.querySelector("[role=dialog]")!;
  expect(dialog).not.toBeNull();
  expect(dialog.querySelector<HTMLInputElement>("input[name=amount]")!.value).toBe("268.00");
  expect(dialog.textContent).toContain("Plin");
});

test("shows the state badges and gives a confirmed row Anular pago without a remove control", async () => {
  await mount(<OrderPaymentsPanel {...savedProps(savedOrder({ payments: [confirmed, reported, rejected, voided] }))} />);
  const text = container.textContent!;
  for (const badge of ["Confirmado", "Por revisar", "Rechazado", "Anulado"]) expect(text).toContain(badge);
  expect(buttons().filter(button => button.textContent === "Anular pago")).toHaveLength(1);
  expect(buttonNamed("Quitar")).toBeUndefined();
  expect(buttonNamed("Aprobar")).toBeDefined();
  expect(text).toContain("Motivo: Borroso");
  // Newest first: the report of the 30th comes before the confirmed payment of the 29th.
  expect(text.indexOf("2026-10-30")).toBeLessThan(text.indexOf("2026-10-29"));
});

test("summarizes none, partial, paid, excess and pending review", () => {
  const base = { reviewPending: false };
  expect(paymentsSummary({ ...base, ...estimate(418, 0) })).toEqual({ key: "none" });
  expect(paymentsSummary({ ...base, ...estimate(418, 150) })).toEqual({ key: "partial", amount: money(268) });
  expect(paymentsSummary({ ...base, ...estimate(418, 418) })).toEqual({ key: "paid" });
  expect(paymentsSummary({ ...base, ...estimate(418, 430) })).toEqual({ key: "paidExcess", amount: money(12) });
});

test("shows the summary line and Pago por revisar on a saved order with a pending report", async () => {
  await mount(<OrderPaymentsPanel {...savedProps(savedOrder({ payments: [confirmed, reported] }))} />);
  expect(container.textContent).toContain("Pago parcial · falta S/ 268.00");
  expect(container.textContent).toContain("Pago por revisar");
});
