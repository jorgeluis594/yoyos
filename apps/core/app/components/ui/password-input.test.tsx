// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import resources from "@core/app/locales";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PasswordInput } from "@/components/ui/password-input";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const i18n = createInstance();
await i18n.use(initReactI18next).init({ lng: "es", resources });

let container: HTMLDivElement;
let root: Root;
const onSubmit = vi.fn((event: Event) => event.preventDefault());

beforeEach(() => {
  onSubmit.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(
    <I18nextProvider i18n={i18n}>
      <form onSubmit={onSubmit as unknown as React.FormEventHandler}>
        <input aria-label="Antes" />
        <PasswordInput id="password" name="password" autoComplete="current-password" minLength={8} maxLength={128} required defaultValue="secreto123" />
        <button type="submit">Enviar</button>
      </form>
    </I18nextProvider>,
  ));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const input = () => container.querySelector<HTMLInputElement>("#password")!;
const eye = () => container.querySelector<HTMLButtonElement>("[data-slot=password-input] button")!;

test("starts hidden, keeps the input props and exposes a non-submitting button", () => {
  expect(input().type).toBe("password");
  expect(input().autocomplete).toBe("current-password");
  expect(input().minLength).toBe(8);
  expect(input().maxLength).toBe(128);
  expect(input().required).toBe(true);
  expect(eye().type).toBe("button");
  expect(eye().getAttribute("aria-label")).toBe("Mostrar contraseña");
  expect(eye().getAttribute("aria-pressed")).toBe("false");
});

test("toggling switches the input type, label and pressed state without submitting", () => {
  act(() => eye().click());
  expect(input().type).toBe("text");
  expect(eye().getAttribute("aria-label")).toBe("Ocultar contraseña");
  expect(eye().getAttribute("aria-pressed")).toBe("true");
  act(() => eye().click());
  expect(input().type).toBe("password");
  expect(eye().getAttribute("aria-label")).toBe("Mostrar contraseña");
  expect(onSubmit).not.toHaveBeenCalled();
});

test("a disabled input has a disabled eye", () => {
  act(() => root.render(<I18nextProvider i18n={i18n}><PasswordInput id="password" defaultValue="x" disabled /></I18nextProvider>));
  expect(input().disabled).toBe(true);
  expect(eye().disabled).toBe(true);
});

const nextFrame = () => act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

test("pointer activation puts focus back on the input (caret restore is covered by the E2E)", async () => {
  input().focus();
  act(() => eye().dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })));
  await nextFrame();
  expect(document.activeElement).toBe(input());
});

test("keyboard activation keeps focus on the button so it can be pressed again", async () => {
  eye().focus();
  act(() => eye().click());
  await nextFrame();
  expect(input().type).toBe("text");
  expect(document.activeElement).toBe(eye());
  act(() => eye().click());
  expect(input().type).toBe("password");
});

test("is reachable right after the input in tab order and is a native button", () => {
  const tabbable = Array.from(container.querySelectorAll<HTMLElement>("input, button")).filter((el) => el.tabIndex >= 0);
  expect(tabbable.indexOf(eye())).toBe(tabbable.indexOf(input()) + 1);
  expect(eye().tagName).toBe("BUTTON");
});

test("a controlled value survives the toggle and typing still reaches onChange", () => {
  const onChange = vi.fn();
  function Controlled() {
    const [value, setValue] = React.useState("abc");
    return <PasswordInput id="password" value={value} onChange={(event) => { onChange(event.target.value); setValue(event.target.value); }} />;
  }
  act(() => root.render(<I18nextProvider i18n={i18n}><Controlled /></I18nextProvider>));
  act(() => eye().click());
  expect(input().value).toBe("abc");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => { setter.call(input(), "abcd"); input().dispatchEvent(new Event("input", { bubbles: true })); });
  expect(onChange).toHaveBeenCalledWith("abcd");
  expect(input().value).toBe("abcd");
});

test("forwards the ref to the input element", () => {
  const ref = React.createRef<HTMLInputElement>();
  act(() => root.render(<I18nextProvider i18n={i18n}><PasswordInput id="password" ref={ref} /></I18nextProvider>));
  expect(ref.current).toBe(input());
});
