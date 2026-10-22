// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { applyColorPreference, applyPreferenceScript, colorSchemeOf } from "@core/app/color-scheme";
import { handle as checkoutHandle } from "@core/app/routes/checkout";
import { handle as previewHandle } from "@core/app/routes/store-appearance-preview";
import { StoreTheme } from "@core/src/features/store-appearance/presentation/store-theme";

const checkoutLoaded = { handle: checkoutHandle, data: { checkout: { number: 1 }, message: null } };
const checkoutUnavailable = { handle: checkoutHandle, data: undefined };

/** Runs the head script on the page, with the system preferring `systemDark` and `preference` stored. */
function runHeadScript(systemDark: boolean, preference: string | null) {
  if (preference) localStorage.setItem("yoyos-theme", preference);
  window.matchMedia = ((query: string) => ({ matches: systemDark && query.includes("dark") })) as typeof window.matchMedia;
  new Function(applyPreferenceScript)();
}
const dark = () => document.documentElement.classList.contains("dark");
const setScheme = (matches: Parameters<typeof colorSchemeOf>[0]) => {
  if (colorSchemeOf(matches) === "fixed") document.documentElement.dataset.colorScheme = "fixed";
};

beforeEach(() => { localStorage.clear(); delete document.documentElement.dataset.colorScheme; document.documentElement.classList.remove("dark"); });
afterEach(() => { localStorage.clear(); });

describe("root color scheme", () => {
  test("leaves the dark class off on a themed checkout whatever the system prefers", () => {
    setScheme([checkoutLoaded]);
    expect(document.documentElement.dataset.colorScheme).toBe("fixed");
    runHeadScript(true, null);
    expect(dark()).toBe(false);
    runHeadScript(false, "dark");
    expect(dark()).toBe(false);
    applyColorPreference(document.documentElement, "dark", true);
    expect(dark()).toBe(false);
  });

  test("leaves the dark class off on the editor preview", () => {
    setScheme([{ handle: previewHandle, data: { companyName: "Lima Studio" } }]);
    runHeadScript(true, "dark");
    expect(dark()).toBe(false);
  });

  test("follows the system preference on «Enlace no disponible»", () => {
    setScheme([checkoutUnavailable]);
    expect(colorSchemeOf([checkoutUnavailable])).toBe("system");
    expect(colorSchemeOf([{ handle: checkoutHandle, data: { checkout: null, message: "x" } }])).toBe("system");
    runHeadScript(true, null);
    expect(dark()).toBe(true);
  });

  test("follows the stored preference on routes without a color scheme handle", () => {
    expect(colorSchemeOf([{ handle: undefined, data: {} }, { handle: { other: true }, data: {} }])).toBe("system");
    runHeadScript(true, "light");
    expect(dark()).toBe(false);
    runHeadScript(false, "dark");
    expect(dark()).toBe(true);
    applyColorPreference(document.documentElement, null, true);
    expect(dark()).toBe(true);
  });

  test("lets the deepest matched route decide", () => {
    expect(colorSchemeOf([checkoutLoaded, { handle: undefined, data: {} }])).toBe("system");
    expect(colorSchemeOf([{ handle: undefined, data: {} }, checkoutLoaded])).toBe("fixed");
  });

  test("keeps each theme inside its own checkout", () => {
    setScheme([checkoutLoaded]);
    runHeadScript(true, null);
    const html = renderToStaticMarkup(<>
      <StoreTheme appearance={{ theme: "noche" }}><p /></StoreTheme>
      <StoreTheme appearance={{ theme: "boutique" }}><p /></StoreTheme>
    </>);
    const scopes = [...html.matchAll(/<div ([^>]*data-store-theme="[^"]+"[^>]*)>/g)].map((match) => match[1]);
    expect(dark()).toBe(false);
    expect(scopes[0]).toMatch(/class="dark /);
    expect(scopes[1]).not.toMatch(/dark/);
  });
});
