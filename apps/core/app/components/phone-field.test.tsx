// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { expect, test } from "vitest";
import resources from "@core/app/locales";
import { PhoneField } from "@core/app/components/phone-field";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const i18n = createInstance();
await i18n.use(initReactI18next).init({ lng: "es", resources });

async function mount(initial = "") {
  const changes: string[] = [];
  function Harness() {
    const [value, setValue] = useState(initial);
    return <PhoneField id="phone" value={value} onChange={next => { changes.push(next); setValue(next); }} />;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<I18nextProvider i18n={i18n}><Harness /></I18nextProvider>));
  const select = container.querySelector<HTMLSelectElement>("select")!;
  const input = container.querySelector<HTMLInputElement>("input#phone")!;
  return { changes, select, input, container, unmount: () => root.unmount() };
}

async function type(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => { setter.call(input, text); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function pick(select: HTMLSelectElement, iso: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
  await act(async () => { setter.call(select, iso); select.dispatchEvent(new Event("change", { bubbles: true })); });
}

test("opens with Peru +51 selected and the full country list in the selector", async () => {
  const { select, input, container, unmount } = await mount();
  expect(select.value).toBe("PE");
  expect(select.getAttribute("aria-label")).toBe("País del teléfono");
  expect(select.selectedOptions[0].textContent).toMatch(/^PE \+51/);
  expect(select.options.length).toBeGreaterThan(220);
  expect([...select.options].some(option => option.textContent?.includes("Estados Unidos") && option.textContent.includes("+1"))).toBe(true);
  expect(input.value).toBe("");
  expect(container.textContent).not.toContain("Incluye el código de país");
  unmount();
});

test("the national number typed with spaces is reported as E.164 without spaces", async () => {
  const { changes, input, unmount } = await mount();
  await type(input, "977 909 427");
  expect(changes.at(-1)).toBe("+51977909427");
  expect(input.value).toBe("977 909 427");
  unmount();
});

test("changing the country keeps the typed number under the new dial code", async () => {
  const { changes, select, input, unmount } = await mount();
  await type(input, "415 555 2671");
  await pick(select, "US");
  expect(changes.at(-1)).toBe("+14155552671");
  expect(select.value).toBe("US");
  unmount();
});

test("a saved phone is split into its country and national number", async () => {
  const { select, input, unmount } = await mount("+5491112345678");
  expect(select.value).toBe("AR");
  expect(input.value).toBe("91112345678");
  unmount();
});

test("pasting an international number switches the country and drops the code from the box", async () => {
  const { changes, select, input, unmount } = await mount();
  await type(input, "+34 612 345 678");
  expect(select.value).toBe("ES");
  expect(input.value).toBe("612345678");
  expect(changes.at(-1)).toBe("+34612345678");
  unmount();
});

test("clearing the number reports an empty phone and keeps the chosen country", async () => {
  const { changes, select, input, unmount } = await mount("+14155552671");
  await type(input, "");
  expect(changes.at(-1)).toBe("");
  expect(select.value).toBe("US");
  unmount();
});

test("exposes the invalid state and description to assistive technology", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(<I18nextProvider i18n={i18n}><PhoneField id="phone" value="" onChange={() => undefined} invalid describedBy="phone-error" /></I18nextProvider>));
  const input = container.querySelector("input#phone")!;
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(input.getAttribute("aria-describedby")).toBe("phone-error");
  expect(input.getAttribute("inputmode")).toBe("tel");
  root.unmount();
});

test("a saved phone that is not E.164 shows its digits under the default country", async () => {
  const { select, input, unmount } = await mount("999123456");
  expect(select.value).toBe("PE");
  expect(input.value).toBe("999123456");
  unmount();
});

test("the closed selector shows only the ISO code and the dial code of the chosen country", async () => {
  const { select, unmount } = await mount();
  expect(select.selectedOptions[0].textContent).toBe("PE +51");
  await pick(select, "US");
  expect(select.selectedOptions[0].textContent).toBe("US +1");
  unmount();
});

test("typing «+» and the code character by character splits the phone like pasting it", async () => {
  const { changes, select, input, unmount } = await mount();
  await type(input, "+");
  expect(input.value).toBe("+");
  expect(changes.at(-1)).toBe("");
  await type(input, "+3");
  expect(input.value).toBe("+3");
  await type(input, "+34");
  expect(select.value).toBe("ES");
  expect(input.value).toBe("");
  await type(input, "612 345 678");
  expect(changes.at(-1)).toBe("+34612345678");
  unmount();
});
