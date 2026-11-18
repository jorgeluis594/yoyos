// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createRoutesStub } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import resources from "@core/app/locales";
import type { OrderAggregateResponse } from "@shared/contracts/orders";
import type { PaymentRow } from "@core/src/features/orders/presentation/order-view-state";
import { OrderPaymentsPanel, paymentsSummary, type PaymentsPanelProps } from "@core/src/features/orders/presentation/order-payments-panel";
import { catalogPaymentOptions, type PaymentOptions } from "@core/src/features/orders/presentation/payment-options";

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
  ({ mode: "saved", order, receiptUrls: {}, manualPaymentId: "new-payment", voidResult: undefined, unsavedChanges: false, hasProducts: true, format, paymentOptions: catalogPaymentOptions, paymentSettingsHref: "/es-PE/settings/payments", ...extra }) as unknown as PaymentsPanelProps;
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

function NewSale({ total: initialTotal, products = true, initial = [], togglable = false, onRows, options = catalogPaymentOptions }: { total: number; products?: boolean; initial?: PaymentRow[]; togglable?: boolean; onRows?: (rows: readonly PaymentRow[]) => void; options?: PaymentOptions }) {
  const [payments, setPayments] = useState<readonly PaymentRow[]>(initial);
  onRows?.(payments);
  const [total, setTotal] = useState(initialTotal);
  const paid = payments.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  let next = 0;
  return <>
    {togglable && <button type="button" data-testid="products-change" onClick={() => setTotal(total + 100)} />}
    <OrderPaymentsPanel mode="new" hasProducts={products} format={format} payments={payments} onChange={setPayments}
      estimate={estimate(total, paid)} newPaymentId={() => `draft-${++next}`} paymentOptions={options} paymentSettingsHref="/es-PE/settings/payments" />
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

test("offers only the methods the payment settings enable, on a new sale and a saved order", async () => {
  const options: PaymentOptions = { choices: ["plin", "bank_transfer"], walletName: "Plin", unconfigured: false };
  await mount(<NewSale total={418} options={options} />);
  expect(buttons().map(button => button.textContent)).toEqual(["Agregar Plin", "Transferencia bancaria"]);
  act(() => root!.unmount());
  container.remove();
  await mount(<OrderPaymentsPanel {...savedProps(savedOrder(), { paymentOptions: options })} />);
  expect(buttons().map(button => button.textContent)).not.toContain("Agregar Yape");
  expect(buttons().map(button => button.textContent)).toEqual(expect.arrayContaining(["Agregar Plin", "Transferencia bancaria"]));
});

test("records the company's own wallet under its configured name and without a provider", async () => {
  let rows: readonly PaymentRow[] = [];
  await mount(<NewSale total={418} options={{ choices: ["digital_wallet"], walletName: "Lukita", unconfigured: false }} onRows={next => { rows = next; }} />);
  act(() => buttonNamed("Agregar Lukita")!.click());
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ method: "digital_wallet" });
  expect(rows[0]).not.toHaveProperty("walletProvider");
  expect(container.textContent).toContain("Lukita");
});

test("offers the whole catalog and links to the settings while no method is configured", async () => {
  await mount(<NewSale total={418} options={{ ...catalogPaymentOptions, unconfigured: true }} />);
  expect(buttons().map(button => button.textContent)).toEqual(["Agregar Yape", "Agregar Plin", "Transferencia bancaria"]);
  const link = [...container.querySelectorAll("a")].find(anchor => anchor.textContent === "Configurar medios de cobro");
  expect(link?.getAttribute("href")).toBe("/es-PE/settings/payments");
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

const stockBoxes = () => [...container.querySelectorAll<HTMLElement>("button[role=checkbox], input[type=checkbox]")];

test("shows the partial stock box only while the draft row leaves a balance", async () => {
  await mount(<NewSale total={418} />);
  act(() => buttonNamed("Agregar Yape")!.click());
  expect(stockBoxes()).toHaveLength(0);
  type(amountInputs()[0]!, "50");
  expect(stockBoxes()).toHaveLength(1);
  type(amountInputs()[0]!, "418");
  expect(stockBoxes()).toHaveLength(0);
});

test("stores deductStockIfPartial false once the stock box disappears after being ticked", async () => {
  let rows: readonly PaymentRow[] = [];
  await mount(<NewSale total={418} onRows={current => { rows = current; }} />);
  act(() => buttonNamed("Agregar Yape")!.click());
  type(amountInputs()[0]!, "50");
  act(() => stockBoxes()[0]!.click());
  expect(rows[0]!.deductStockIfPartial).toBe(true);
  type(amountInputs()[0]!, "418");
  expect(stockBoxes()).toHaveLength(0);
  expect(rows[0]!.deductStockIfPartial).toBe(false);
});

test("returns the focus to the first payment button after Quitar", async () => {
  await mount(<NewSale total={418} />);
  act(() => buttonNamed("Agregar Plin")!.click());
  act(() => buttonNamed("Quitar")!.click());
  expect(document.activeElement).toBe(buttonNamed("Agregar Yape"));
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
});

test("keeps Ver captura enabled while there are unsaved changes", async () => {
  await mount(<OrderPaymentsPanel {...savedProps(savedOrder({ payments: [confirmed, reported] }), { unsavedChanges: true, receiptUrls: { "p-2": "https://example.test/receipt.png" } })} />);
  const button = buttonNamed("Ver captura");
  expect(button).toBeDefined();
  expect(button!.disabled).toBe(false);
  expect(button!.getAttribute("aria-disabled")).toBeNull();
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

// ---------------------------------------------------------------------------------------------------------------------
// Amount limit, void confirmation and the paid-order report

const plain = (text: string | null | undefined) => (text ?? "").replace(/\u00a0/g, " ");
const dialogText = () => plain(document.body.querySelector("[role=dialog]")?.textContent);
const dialogButton = (text: string) => [...document.body.querySelectorAll<HTMLButtonElement>("[role=dialog] button")].find(button => button.textContent === text);
const dialogAmount = () => document.body.querySelector<HTMLInputElement>("[role=dialog] input[name=amount]")!;

async function mountWithAction(element: React.ReactElement, action: () => unknown) {
  const Stub = createRoutesStub([{ path: "*", Component: () => element, action }]);
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () => root!.render(<I18nextProvider i18n={i18n}><Stub initialEntries={["/"]} /></I18nextProvider>));
}

const buyer = { contactId: null, name: "Ana Pérez", phone: null };
const order60 = (overrides: Record<string, unknown> = {}) => savedOrder({ number: 1001, total: money(60), paidAmount: money(0), balanceDue: money(60), payments: [], ...overrides });

test("the amount above the balance shows the balance and disables saving", async () => {
  await mount(<OrderPaymentsPanel {...savedProps(order60())} />);
  act(() => buttonNamed("Agregar Yape")!.click());
  type(dialogAmount(), "999");
  expect(dialogText()).toContain("Supera el saldo pendiente de S/ 60.00");
  expect(dialogButton("Confirmar pago")!.disabled).toBe(true);
  type(dialogAmount(), "60");
  expect(dialogText()).not.toContain("Supera el saldo pendiente");
  expect(dialogButton("Confirmar pago")!.disabled).toBe(false);
});

test("an empty, non-numeric or zero amount shows its own reason and disables saving", async () => {
  await mount(<OrderPaymentsPanel {...savedProps(order60())} />);
  act(() => buttonNamed("Agregar Yape")!.click());
  const reasons: Array<[string, string]> = [["", "Escribe el monto del pago."], ["abc", "Escribe un importe mayor a 0 con hasta 2 decimales."], ["12e", "Escribe un importe mayor a 0 con hasta 2 decimales."], ["-5", "Escribe un importe mayor a 0 con hasta 2 decimales."], ["0", "El monto debe ser mayor que cero."], ["12.345", "Escribe un importe mayor a 0 con hasta 2 decimales."]];
  for (const [typed, reason] of reasons) {
    type(dialogAmount(), typed);
    expect(dialogText(), typed).toContain(reason);
    expect(dialogButton("Confirmar pago")!.disabled, typed).toBe(true);
  }
});

test("a new-sale payment above what is left to collect shows the amount left and disables saving", async () => {
  const row = (paymentId: string, amount: string): PaymentRow => ({ paymentId, amount, method: "digital_wallet", walletProvider: "yape", deductStockIfPartial: false });
  await mount(<NewSale total={55} initial={[row("a", "40"), row("b", "15")]} />);
  expect(plain(container.textContent)).not.toContain("Este pago supera");
  type(amountInputs()[1]!, "20");
  expect(plain(container.textContent)).toContain("Este pago supera lo que falta cobrar de la venta: S/ 15.00.");
  expect(amountInputs()[1]!.getAttribute("aria-invalid")).toBe("true");
  expect(amountInputs()[0]!.getAttribute("aria-invalid")).toBe("false");
  type(amountInputs()[1]!, "15");
  expect(plain(container.textContent)).not.toContain("Este pago supera");
});

test("voiding a payment asks for confirmation naming the amount, order and buyer", async () => {
  const action = vi.fn(() => ({ url: null, success: true, error: false }));
  const twenty = { ...confirmed, id: "p-20", amount: money(20) };
  await mountWithAction(<OrderPaymentsPanel {...savedProps(order60({ buyer, paidAmount: money(20), balanceDue: money(40), payments: [twenty] }))} />, action);
  act(() => buttonNamed("Anular pago")!.click());
  expect(action).not.toHaveBeenCalled();
  expect(dialogText()).toContain("¿Anular el pago de S/ 20.00?");
  expect(dialogText()).toContain("Pedido #1001 · Ana Pérez. El monto vuelve al saldo pendiente.");
  await act(async () => dialogButton("Anular pago")!.click());
  expect(action).toHaveBeenCalledTimes(1);
});

test("the void confirmation of an order without buyer names only the order", async () => {
  await mount(<OrderPaymentsPanel {...savedProps(order60({ buyer: null, paidAmount: money(20), balanceDue: money(40), payments: [{ ...confirmed, amount: money(20) }] }))} />);
  act(() => buttonNamed("Anular pago")!.click());
  expect(dialogText()).toContain("Pedido #1001. El monto vuelve al saldo pendiente.");
  expect(dialogText()).not.toContain("·  ·");
  expect(dialogText()).not.toMatch(/Pedido #1001 ·/);
});

test("cancelling the void confirmation leaves the payment confirmed", async () => {
  const action = vi.fn(() => ({ url: null, success: true, error: false }));
  await mountWithAction(<OrderPaymentsPanel {...savedProps(order60({ buyer, paidAmount: money(20), balanceDue: money(40), payments: [{ ...confirmed, amount: money(20) }] }))} />, action);
  act(() => buttonNamed("Anular pago")!.click());
  await act(async () => dialogButton("Mantener pago")!.click());
  expect(document.body.querySelector("[role=dialog]")).toBeNull();
  expect(action).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Confirmado");
  expect(buttonNamed("Anular pago")).toBeDefined();
});

test("a report on a paid order cannot be approved, says to reject a repeated receipt, and can still be rejected", async () => {
  await mount(<OrderPaymentsPanel {...savedProps(order60({ paidAmount: money(60), balanceDue: money(0), payments: [{ ...confirmed, amount: money(60) }, reported] }))} />);
  expect(buttonNamed("Aprobar")!.disabled).toBe(true);
  expect(buttonNamed("Rechazar")!.disabled).toBe(false);
  expect(plain(container.textContent)).toContain("Este pedido ya está pagado. Si el comprobante repite un pago que ya registraste, recházalo: el motivo que escribas lo verá el comprador.");
  act(() => buttonNamed("Rechazar")!.click());
  expect(dialogText()).toContain("Rechazar");
});

test("when core still refuses the amount the dialog shows the balance core sent", async () => {
  const action = vi.fn(() => ({ url: null, success: false, error: "PAYMENT_EXCEEDS_BALANCE", balanceDue: money(25) }));
  await mountWithAction(<OrderPaymentsPanel {...savedProps(order60())} />, action);
  act(() => buttonNamed("Agregar Yape")!.click());
  await act(async () => dialogButton("Confirmar pago")!.click());
  await vi.waitFor(() => expect(dialogText()).toContain("Supera el saldo pendiente de S/ 25.00"));
  expect(document.body.querySelector("[role=dialog] [role=alert]")).not.toBeNull();
});

test("a cleared prefilled amount on a new-sale row is not announced as an alert before a save attempt", async () => {
  const row = (paymentId: string, amount: string): PaymentRow => ({ paymentId, amount, method: "digital_wallet", walletProvider: "yape", deductStockIfPartial: false });
  await mount(<NewSale total={55} initial={[row("a", "55")]} />);
  type(amountInputs()[0]!, "");
  expect(container.querySelector("[role=alert]")).toBeNull();
  type(amountInputs()[0]!, "abc");
  expect(plain(container.querySelector("[role=alert]")?.textContent)).toBe("Escribe un importe mayor a 0 con hasta 2 decimales.");
});

test("opening the void confirmation clears the previous «Pago actualizado.»", async () => {
  const twenty = { ...confirmed, id: "p-20", amount: money(20) };
  await mount(<OrderPaymentsPanel {...savedProps(order60({ paidAmount: money(20), balanceDue: money(40), payments: [twenty] }), { voidResult: { success: true, error: false } })} />);
  expect(container.textContent).toContain("Pago actualizado.");
  act(() => buttonNamed("Anular pago")!.click());
  expect(container.textContent).not.toContain("Pago actualizado.");
});

test("the refusal of an amount above the balance is said once when the field already explains it", async () => {
  const action = vi.fn(() => ({ url: null, success: false, error: "PAYMENT_EXCEEDS_BALANCE", balanceDue: money(25) }));
  const Harness = () => { const [order, setOrder] = useState(order60()); return <>
    <button type="button" data-testid="reload" onClick={() => setOrder(order60({ paidAmount: money(35), balanceDue: money(25) }))} />
    <OrderPaymentsPanel {...savedProps(order)} /></>; };
  await mountWithAction(<Harness />, action);
  act(() => buttonNamed("Agregar Yape")!.click());
  type(dialogAmount(), "60");
  await act(async () => dialogButton("Confirmar pago")!.click());
  await vi.waitFor(() => expect(action).toHaveBeenCalled());
  await act(async () => container.querySelector<HTMLButtonElement>("[data-testid=reload]")!.click());
  const text = dialogText();
  expect(text.match(/Supera el saldo pendiente de S\/ 25\.00/g)).toHaveLength(1);
});
