// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createRoutesStub } from "react-router";
import { afterEach, expect, test } from "vitest";
import resources from "@core/app/locales";
import { PaymentDialog } from "@core/src/features/orders/presentation/receipt-dialog";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const i18n = createInstance();
await i18n.use(initReactI18next).init({ lng: "es", resources });
let root: Root | undefined;
let container: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); root = undefined; container.remove(); });

const money = (amount: number) => ({ amount, currency: "PEN" as const });
const order = { number: 1042, cancelled: false, stockDeducted: false, total: money(418), balanceDue: money(268) } as never;
const reported = { id: "p-2", status: "reported", amount: null, method: null, data: { reportedAt: "2026-10-30T10:00:00.000Z" } } as never;
const format = { amount: (value: { amount: number }) => `S/ ${value.amount.toFixed(2)}`, date: (iso: string) => iso.slice(0, 10) };

async function mount(extra: { initialChoice?: "plin"; approveBlockedNote?: string } = {}) {
  const noop = () => undefined;
  const Stub = createRoutesStub([{ path: "*", Component: () => <PaymentDialog kind="receipt" paymentId="p-2" payment={reported} order={order} receiptUrl={null} format={format}
    onClose={noop} onDone={noop} onSubmitted={noop} onUncertain={noop} onCloseAutoFocus={noop} {...extra} /> }]);
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () => root!.render(<I18nextProvider i18n={i18n}><Stub initialEntries={["/"]} /></I18nextProvider>));
}
const approve = () => [...document.body.querySelectorAll<HTMLButtonElement>("[role=dialog] button")].find(button => button.textContent === "Aprobar")!;

test("offers Aprobar as always when no note blocks it", async () => {
  await mount();
  expect(approve().getAttribute("aria-disabled")).toBeNull();
  act(() => approve().click());
  expect(document.body.querySelector("[role=dialog] input[name=amount]")).not.toBeNull();
});

test("blocks Aprobar with its note and keeps Rechazar available", async () => {
  await mount({ approveBlockedNote: "Guarda o descarta los cambios primero." });
  expect(approve().getAttribute("aria-disabled")).toBe("true");
  expect(document.getElementById(approve().getAttribute("aria-describedby")!)?.textContent).toBe("Guarda o descarta los cambios primero.");
  act(() => approve().click());
  expect(document.body.querySelector("[role=dialog] input[name=amount]")).toBeNull();
  const reject = [...document.body.querySelectorAll<HTMLButtonElement>("[role=dialog] button")].find(button => button.textContent === "Rechazar")!;
  expect(reject.getAttribute("aria-disabled")).toBeNull();
});
