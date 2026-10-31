// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { afterEach, expect, test, vi } from "vitest";
import resources from "@core/app/locales";
import { OrderCustomerCard, type OrderCustomerCardProps } from "@core/src/features/orders/presentation/order-customer-card";
import type { CustomerDraft, InvalidField } from "@core/src/features/orders/presentation/order-view-state";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const i18n = createInstance();
await i18n.use(initReactI18next).init({ lng: "es", resources });
let root: Root | undefined;
let container: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); root = undefined; container.remove(); });

type Options = Partial<Pick<OrderCustomerCardProps, "source" | "locked" | "marks" | "required">> & { customer?: CustomerDraft };
const jorge: CustomerDraft = { name: "Jorge Gonzalez", phone: "+51977909427" };

async function mount(options: Options = {}) {
  const changes: CustomerDraft[] = [];
  const onRemove = vi.fn();
  function Harness() {
    const [customer, setCustomer] = useState(options.customer ?? { name: "", phone: "" });
    return <OrderCustomerCard customer={customer} source={options.source ?? "manual"} locked={options.locked ?? false} required={options.required ?? false} marks={options.marks ?? []}
      onChange={next => { changes.push(next); setCustomer(next); }} onRemove={() => { onRemove(); setCustomer({ name: "", phone: "" }); }} />;
  }
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () => root!.render(<I18nextProvider i18n={i18n}><Harness /></I18nextProvider>));
  return { changes, onRemove };
}
const nameInput = () => container.querySelector<HTMLInputElement>("#customer-name")!;
const phoneInput = () => container.querySelector<HTMLInputElement>("#customer-phone")!;
const removeButton = () => [...container.querySelectorAll("button")].find(button => button.textContent === "Quitar cliente");
async function type(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => { setter.call(input, text); input.dispatchEvent(new Event("input", { bubbles: true })); });
}

test("shows the title, the hint and empty name and phone fields on a new sale", async () => {
  await mount();
  expect(container.textContent).toContain("Cliente (opcional)");
  expect(container.textContent).toContain("Escribe su nombre y celular.");
  expect(nameInput().value).toBe("");
  expect(phoneInput().value).toBe("");
  expect(removeButton()).toBeUndefined();
});

test("marks the missing field when only the name is typed", async () => {
  const marks: InvalidField[] = [{ section: "customer", field: "customerPhone", reason: "customer_incomplete" }];
  await mount({ customer: { name: "Jorge", phone: "" }, marks });
  expect(phoneInput().getAttribute("aria-invalid")).toBe("true");
  expect(nameInput().getAttribute("aria-invalid")).not.toBe("true");
  expect(container.textContent).toContain("Completa nombre y celular, o deja ambos vacíos.");
  const described = phoneInput().getAttribute("aria-describedby")!;
  expect(container.querySelector(`#${described}`)?.textContent).toContain("Completa nombre y celular");
});

test("names the invalid phone and the too long name", async () => {
  await mount({ customer: { name: "x", phone: "+5112" }, marks: [{ section: "customer", field: "customerName", reason: "customer_invalid" }, { section: "customer", field: "customerPhone", reason: "customer_invalid" }] });
  expect(container.textContent).toContain("Escribe un celular válido con su código de país.");
  expect(container.textContent).toContain("El nombre admite hasta 120 caracteres.");
});

test("reports the typed name and the phone in E.164 even when typed with spaces and a plus", async () => {
  const { changes } = await mount();
  await type(nameInput(), "Jorge");
  await type(phoneInput(), "+51 977 909 427");
  expect(changes.at(-1)).toEqual({ name: "Jorge", phone: "+51977909427" });
});

test("offers Quitar cliente only on orders without a WhatsApp contact", async () => {
  await mount({ customer: jorge, source: "manual" });
  expect(removeButton()).toBeDefined();
  act(() => root!.unmount()); container.remove();
  await mount({ customer: jorge, source: "whatsapp" });
  expect(removeButton()).toBeUndefined();
  expect(container.querySelector('[aria-label="WhatsApp"]')).not.toBeNull();
});

test("Quitar cliente empties both fields and returns focus to the name", async () => {
  const { onRemove } = await mount({ customer: jorge });
  await act(async () => removeButton()!.click());
  expect(onRemove).toHaveBeenCalledOnce();
  expect(nameInput().value).toBe("");
  expect(phoneInput().value).toBe("");
  expect(document.activeElement).toBe(nameInput());
  expect(removeButton()).toBeUndefined();
});

test("a WhatsApp order without name or phone shows the chat hint and keeps the fields editable", async () => {
  await mount({ source: "whatsapp" });
  expect(container.textContent).toContain("Cliente del chat de WhatsApp. Agrega su nombre y celular si los conoces.");
  expect(nameInput().disabled).toBe(false);
});

test("a cancelled order is read-only with no Quitar cliente", async () => {
  await mount({ customer: jorge, locked: true });
  expect(nameInput().disabled).toBe(true);
  expect(phoneInput().disabled).toBe(true);
  expect(container.querySelector("select")?.disabled).toBe(true);
  expect(removeButton()).toBeUndefined();
});

test("a buyer-confirmed order drops Quitar cliente and the optional title, and says why the customer cannot be cleared", async () => {
  await mount({ customer: jorge, required: true });
  expect(removeButton()).toBeUndefined();
  expect(container.textContent).not.toContain("(opcional)");
  expect(container.textContent).toContain("Cliente");
  expect(container.textContent).toContain("El comprador confirmó este pedido con sus datos. Puedes cambiar el cliente, pero no dejarlo vacío.");
  expect(nameInput().disabled).toBe(false);
  await type(nameInput(), "Marta");
  expect(nameInput().value).toBe("Marta");
});

test("an order that was not confirmed by the buyer shows no required note", async () => {
  await mount({ customer: jorge });
  expect(container.textContent).not.toContain("El comprador confirmó este pedido");
});
