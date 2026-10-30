// @vitest-environment jsdom
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

test("the label «Contraseña» exact resolves to the input, not the button", () => {
  expect(container.querySelectorAll("[aria-label='Contraseña']").length).toBe(0);
  expect(input().value).toBe("secreto123");
});

test("toggling returns focus to the input and restores the selection", () => {
  input().focus();
  input().setSelectionRange(2, 5);
  act(() => eye().click());
  expect(document.activeElement).toBe(input());
  expect([input().selectionStart, input().selectionEnd]).toEqual([2, 5]);
});

test("is reachable and operable with the keyboard", () => {
  const tabbable = Array.from(container.querySelectorAll<HTMLElement>("input, button")).filter((el) => el.tabIndex >= 0);
  expect(tabbable.indexOf(eye())).toBe(tabbable.indexOf(input()) + 1);
  // Enter and Space activate a native <button> by dispatching click; jsdom does not synthesize it.
  expect(eye().tagName).toBe("BUTTON");
  expect(eye().disabled).toBe(false);
  act(() => eye().click());
  expect(input().type).toBe("text");
  expect(document.activeElement).toBe(input());
});
