// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import resources from "@core/app/locales";
import { DispatchSenderCard } from "@core/app/components/dispatch-sender-card";
import { PICKUP_SAVE_DELAY_MS } from "@core/app/components/use-instant-delivery-settings";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const i18n = createInstance();
await i18n.use(initReactI18next).init({ lng: "es", resources });
const empty = { configured: { name: null, phone: null }, effective: { name: "Mi Negocio", phone: null } };
const answer = (name: string) => new Response(JSON.stringify({ configured: { name, phone: null }, effective: { name, phone: null } }), { status: 200 });

let container: HTMLDivElement;
let root: Root;
let bodies: unknown[];
let answers: Array<() => Response>;

beforeEach(() => {
  vi.useFakeTimers();
  bodies = [];
  answers = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => { bodies.push(JSON.parse(String(init.body))); return answers.shift()!(); }));
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root.render(<I18nextProvider i18n={i18n}><DispatchSenderCard sender={empty} companyName="Mi Negocio" /></I18nextProvider>));
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const input = (id: string) => container.querySelector<HTMLInputElement>(`#${id}`)!;
function type(id: string, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(id), value);
    input(id).dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(PICKUP_SAVE_DELAY_MS + 10); });

test("retry sends the text typed after the failure, so the saved state never hides unsent text", async () => {
  answers = [() => new Response("{}", { status: 503 }), () => answer("Segundo")];
  type("sender-name", "Primero");
  await flush();
  expect(container.textContent).toContain("Reintentar");
  type("sender-name", "Segundo");
  const retry = [...container.querySelectorAll("button")].find(button => button.textContent === "Reintentar")!;
  await act(async () => { retry.click(); await vi.advanceTimersByTimeAsync(0); });
  expect(bodies).toEqual([{ name: "Primero", phone: null }, { name: "Segundo", phone: null }]);
  expect(container.textContent).toContain("Guardado");
});

test("leaving the page sends text typed since the last save", async () => {
  answers = [() => answer("Pendiente")];
  type("sender-name", "Pendiente");
  await act(async () => { root.unmount(); });
  expect(bodies).toEqual([{ name: "Pendiente", phone: null }]);
  root = createRoot(container);
});
