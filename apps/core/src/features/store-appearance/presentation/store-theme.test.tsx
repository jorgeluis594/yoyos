// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { storeThemeIds, storeThemes } from "@shared/store-themes";
import * as themeStyle from "@core/src/features/store-appearance/presentation/store-theme-style";
import { StoreTheme } from "@core/src/features/store-appearance/presentation/store-theme";

vi.mock("@core/src/features/store-appearance/presentation/store-theme-style", async (importOriginal) => {
  const original = await importOriginal<typeof import("@core/src/features/store-appearance/presentation/store-theme-style")>();
  return { ...original, storeThemeCss: vi.fn(original.storeThemeCss) };
});
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const styleOf = (html: string) => /<style>(.*?)<\/style>/s.exec(html)?.[1] ?? "";
const scopeOf = (html: string) => /<div data-store-theme="([^"]+)"/.exec(html)?.[1];
const render = (theme: Parameters<typeof StoreTheme>[0]["appearance"]) => renderToStaticMarkup(<StoreTheme appearance={theme}><p>Pedido</p></StoreTheme>);

describe("StoreTheme", () => {
  test("renders Clásico when the company has no appearance", () => {
    const html = render(null);
    expect(html).toContain('data-store-theme-id="classic"');
    expect(styleOf(html)).toContain(`--background:${storeThemes.classic.colors.background};`);
    expect(html).toContain("Pedido");
  });

  test("renders Noche dark even when the page prefers light", () => {
    const html = render({ theme: "noche" });
    expect(html).toMatch(/<div data-store-theme="[^"]+" data-store-theme-id="noche" class="dark /);
    expect(styleOf(html)).toContain("color-scheme:dark;");
    expect(styleOf(html)).toContain(`--background:${storeThemes.noche.colors.background};`);
  });

  test("renders a light theme light even inside a dark page", () => {
    const html = renderToStaticMarkup(<div className="dark"><StoreTheme appearance={{ theme: "boutique" }}><p /></StoreTheme></div>);
    expect(html).not.toMatch(/data-store-theme-id="boutique" class="[^"]*dark/);
    expect(styleOf(html)).toContain("color-scheme:light;");
    expect(styleOf(html)).toContain(`--background:${storeThemes.boutique.colors.background};`);
  });

  test("keeps each theme inside its own checkout", () => {
    const html = renderToStaticMarkup(<>
      <StoreTheme appearance={{ theme: "boutique" }}><p /></StoreTheme>
      <StoreTheme appearance={{ theme: "noche" }}><p /></StoreTheme>
    </>);
    const styles = [...html.matchAll(/<style>(.*?)<\/style>/gs)].map((match) => match[1]);
    const scopes = [...html.matchAll(/<div data-store-theme="([^"]+)"/g)].map((match) => match[1]);
    expect(scopes[0]).not.toBe(scopes[1]);
    expect(styles).toHaveLength(2);
    scopes.forEach((scope, index) => {
      expect([...styles[index].matchAll(/\[data-store-theme="([^"]+)"\]/g)].map((match) => match[1])).toEqual([scope, scope]);
    });
    expect(styles[0]).toContain(`--background:${storeThemes.boutique.colors.background};`);
    expect(styles[1]).toContain(`--background:${storeThemes.noche.colors.background};`);
  });

  test("scopes the chosen theme and paints the page behind it", () => {
    for (const theme of storeThemeIds) {
      const html = render({ theme });
      const scope = scopeOf(html);
      expect(styleOf(html)).toContain(`html:has([data-store-theme="${scope}"])`);
      expect(styleOf(html)).not.toContain(":root");
    }
  });

  test("StoreTheme builds the theme CSS once per theme and scope, not on every render", () => {
    const css = vi.mocked(themeStyle.storeThemeCss);
    css.mockClear();
    let rerender: () => void = () => undefined;
    function Page() {
      const [typed, setTyped] = useState(0);
      rerender = () => setTyped((value) => value + 1);
      return <StoreTheme appearance={{ theme: "boutique" }}><p>{typed}</p></StoreTheme>;
    }
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    act(() => root.render(<Page />));
    for (let keystroke = 0; keystroke < 3; keystroke++) act(() => rerender());
    expect(container.querySelector("p")?.textContent).toBe("3");
    expect(css).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    container.remove();
  });
});
